from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.prospecting.person_research_service import PersonCapture, PersonResearchService
from scripts.prospecting.qualification_service import QualificationService
from scripts.prospecting.ranking_service import RankingService
from scripts.prospecting.selected_person_source import (
    SelectedPersonSourceError,
    resolve_selected_person_source,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_person_research_service import (
    CAMPAIGN_ID,
    _person,
    _request,
    _seed,
    _write,
)
from scripts.prospecting.tests.test_qualification_service import (
    _Adapter,
    _qualification_request,
    _supported_payload,
)
from scripts.prospecting.tests.test_ranking_service import (
    _insert_unrelated_open_employment,
    _rank_request,
)


NOW = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
STAMP = NOW.isoformat().replace("+00:00", "Z")


def _qualify(connection, started, funding, people):
    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)},
        now=lambda: NOW,
    )
    qualification = service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    return qualification


def _ready(tmp_path: Path, captures=None):
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, captures or (_person(tmp_path, selected),)),
    )
    qualification = _qualify(connection, started, funding, people)
    service = RankingService(connection, now=lambda: NOW)
    ranking = service.start_or_resume(_rank_request(started, qualification))
    return connection, started, selected, service, ranking


def _resolve(connection, started, ranking, person_rank_id, **overrides):
    values = {
        "run_id": started.run_id, "campaign_id": CAMPAIGN_ID,
        "person_rank_id": person_rank_id,
        "expected_ranking_batch_hash": ranking.batch_hash, "now": NOW,
    }
    values.update(overrides)
    return resolve_selected_person_source(connection, **values)


def test_selected_person_source_is_exact_deterministic_and_has_no_repr_leak(tmp_path: Path) -> None:
    connection, started, selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]

    resolved = _resolve(connection, started, ranking, person.person_rank_id)
    again = _resolve(connection, started, ranking, person.person_rank_id)

    assert resolved == again
    assert len(resolved.source_context_digest) == 64
    assert resolved.ranking_batch_hash == ranking.batch_hash
    ranking_projection = service.get_projection(started.run_id)
    assert resolved.qualification_batch_id == ranking_projection.qualification_batch_id
    assert resolved.company_id == selected.company_id
    assert resolved.person_id == person.person_id
    assert resolved.employment_id == person.employment_id
    assert resolved.title == "Head of Operations"
    assert resolved.source_candidate_ids == person.source_candidate_ids
    assert len(resolved.source_title_hashes) == len(resolved.source_candidate_ids)
    assert resolved.candidate_observation_id == person.candidate_observation_id
    assert resolved.employment_observation_id == person.employment_observation_id
    assert "Avery Example" in resolved.excerpt
    rendered = repr(resolved)
    assert "Avery" not in rendered and resolved.excerpt not in rendered
    assert resolved.source_url not in rendered
    for table in ("fill_person", "fill_firm", "contact_point", "person_affinity",
                  "evidence", "revision", "approval", "campaign_fit_spec"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    connection.close()


def test_unrelated_open_employment_at_the_same_company_for_another_person_is_ignored(tmp_path: Path) -> None:
    connection, started, selected, service, ranking = _ready(tmp_path)
    _insert_unrelated_open_employment(connection, selected.company_id)
    person = service.get_projection(started.run_id).companies[0].people[0]

    resolved = _resolve(connection, started, ranking, person.person_rank_id)

    assert resolved.person_id == person.person_id
    assert resolved.person_id != "per_ffffffffffffffff"
    assert resolved.employment_id == person.employment_id
    connection.close()


def test_same_person_unrelated_open_employment_at_a_different_company_is_ignored(tmp_path: Path) -> None:
    connection, started, selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("co_secondcompany", "Second Synthetic", "https://second.test/", "manual", "company:second"),
    )
    snapshot_id = connection.execute(
        "SELECT snapshot_id FROM source_snapshot ORDER BY snapshot_id LIMIT 1",
    ).fetchone()[0]
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            "obs_secondrole", person.person_id, '{"excerpt":"second synthetic role"}',
            snapshot_id, STAMP, STAMP, snapshot_id,
        ),
    )
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,NULL,NULL,?,1.0)""",
        (
            "emp_secondrole", person.person_id, "co_secondcompany", "Board Advisor",
            "obs_secondrole",
        ),
    )

    resolved = _resolve(connection, started, ranking, person.person_rank_id)

    assert resolved.employment_id == person.employment_id
    assert resolved.company_id == selected.company_id
    connection.close()


def test_unselected_person_rank_id_is_refused(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "second" / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path / "second")
    captures = (
        _person(tmp_path / "second", selected, title="Head of Operations", slug="avery"),
        _person(
            tmp_path / "second", selected, first_name="Blair", full_name="Blair Example",
            title="Chief Operating Officer", slug="blair",
        ),
        _person(
            tmp_path / "second", selected, first_name="Casey", full_name="Casey Example",
            title="Sales Operations Director", slug="casey",
        ),
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, captures),
    )
    qualification = _qualify(connection, started, funding, people)
    service = RankingService(connection, now=lambda: NOW)
    ranking = service.start_or_resume(_rank_request(started, qualification))
    excluded = next(
        person for person in service.get_projection(started.run_id).companies[0].people
        if not person.selected
    )

    with pytest.raises(SelectedPersonSourceError, match="^person_not_selected$"):
        _resolve(connection, started, ranking, excluded.person_rank_id)
    with pytest.raises(SelectedPersonSourceError, match="^person_rank_missing$"):
        _resolve(connection, started, ranking, "prrp_unknownselection")
    connection.close()


def test_stale_rank_hash_and_wrong_campaign_scope_are_refused(tmp_path: Path) -> None:
    connection, started, _selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]

    with pytest.raises(SelectedPersonSourceError, match="^ranking_batch_stale$"):
        _resolve(
            connection, started, ranking, person.person_rank_id,
            expected_ranking_batch_hash="b" * 64,
        )
    with pytest.raises(SelectedPersonSourceError, match="^campaign_scope_mismatch$"):
        _resolve(
            connection, started, ranking, person.person_rank_id,
            campaign_id="camp_ffffffffffffffff",
        )
    connection.close()


def test_changed_bound_source_evidence_is_refused_without_leaking_private_text(tmp_path: Path) -> None:
    connection, started, _selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]
    body_ref = connection.execute(
        """SELECT body_ref FROM source_snapshot
            WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")

    with pytest.raises(SelectedPersonSourceError) as refused:
        _resolve(connection, started, ranking, person.person_rank_id)

    assert str(refused.value) == "source_changed"
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    connection.close()


def test_original_employment_observation_is_preserved_after_source_replacement(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    first = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    replacement = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example",
        "Head of Operations", "https://profile.test/avery",
        "https://nimbus.test/about/avery",
        _write(
            tmp_path, "resolver-replacement.txt",
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
    qualification = _qualify(connection, started, funding, people)
    service = RankingService(connection, now=lambda: NOW)
    ranking = service.start_or_resume(_rank_request(started, qualification))
    person = service.get_projection(started.run_id).companies[0].people[0]

    resolved = _resolve(connection, started, ranking, person.person_rank_id)

    assert resolved.candidate_observation_id != resolved.employment_observation_id
    assert resolved.employment_observation_id == connection.execute(
        "SELECT source_observation_id FROM employment WHERE employment_id=?",
        (resolved.employment_id,),
    ).fetchone()[0]
    assert resolved.snapshot_id == connection.execute(
        "SELECT snapshot_id FROM source_observation WHERE observation_id=?",
        (resolved.candidate_observation_id,),
    ).fetchone()[0]
    connection.close()


def test_candidate_identity_corruption_is_refused_as_pipeline_context_stale_without_mutation(
    tmp_path: Path,
) -> None:
    connection, started, _selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]
    connection.execute("DROP TRIGGER IF EXISTS prospecting_person_candidate_no_update")
    connection.execute(
        "UPDATE prospecting_person_candidate SET candidate_identity_hash=? WHERE ordinal=0",
        ("f" * 64,),
    )

    before_hash = connection.execute(
        "SELECT candidate_identity_hash FROM prospecting_person_candidate WHERE ordinal=0",
    ).fetchone()[0]

    with pytest.raises(SelectedPersonSourceError, match="^pipeline_context_stale$"):
        _resolve(connection, started, ranking, person.person_rank_id)

    assert connection.execute(
        "SELECT candidate_identity_hash FROM prospecting_person_candidate WHERE ordinal=0",
    ).fetchone()[0] == before_hash
    assert not connection.in_transaction
    for table in ("fill_person", "fill_firm", "contact_point", "person_affinity",
                  "evidence", "revision", "approval", "campaign_fit_spec"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    connection.close()


def test_sqlite_boundary_failure_normalizes_to_store_state_invalid_without_private_text(
    tmp_path: Path,
) -> None:
    connection, started, _selected, service, ranking = _ready(tmp_path)
    person = service.get_projection(started.run_id).companies[0].people[0]
    connection.close()

    with pytest.raises(SelectedPersonSourceError) as refused:
        _resolve(connection, started, ranking, person.person_rank_id)

    assert str(refused.value) == "store_state_invalid"
    assert "closed database" not in str(refused.value)
    assert "ProgrammingError" not in str(refused.value)
    assert "Cannot operate" not in str(refused.value)
