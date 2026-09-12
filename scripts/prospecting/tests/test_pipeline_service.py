from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import fields
from datetime import date
from pathlib import Path
import sqlite3
import uuid

import pytest

from scripts.prospecting.pipeline_service import (
    PipelineError,
    PipelineService,
    PipelineStartRequest,
    ScopeSpec,
    calendar_cutoff,
)
from scripts.prospecting.store import open_store


POLICY_HASH = "a" * 64
CAMPAIGN_ID = "camp_0123456789abcdef"
STAMP = "2026-09-09T12:00:00Z"


def _seed_campaign(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Sender", None, "AI products", "Operations", "Built tools", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
               status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            CAMPAIGN_ID, "networking", "sender-1", '{"predicates":[]}',
            "informational_call", 15, "warm", "networking-v1", "[]", "09:00-17:00",
            "America/New_York", 25, 6, 2, "T0", "mailbox-1", "{}", 0, "draft",
            POLICY_HASH,
        ),
    )


def _request(
    *, request_id: str | None = None, geography: ScopeSpec | None = None,
    sector: ScopeSpec | None = None, years: int = 3, people: int = 2,
    stage_min: str = "series_a", stage_max: str = "series_c",
    specification: str = "Find recently funded startups and two current operators.",
) -> PipelineStartRequest:
    return PipelineStartRequest(
        request_id or str(uuid.uuid4()), CAMPAIGN_ID, "2026-09-09", stage_min,
        stage_max, years, "latest_known", geography or ScopeSpec("any"),
        sector or ScopeSpec("any"), 20, people,
        ("operations", "business_operations", "strategy", "strategy_operations", "chief_of_staff"),
        specification, "Coffee chat first; a possible job is secondary.",
    )


def _service(database: Path) -> tuple[sqlite3.Connection, PipelineService]:
    connection = open_store(database)
    return connection, PipelineService(connection, now=lambda: STAMP)


def test_start_persists_versioned_pilot_intake_and_honest_waiting_stage(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "pipeline.sqlite")
    _seed_campaign(connection)

    result = service.start_or_resume(_request())

    assert result.state == "awaiting_research_adapter"
    assert result.next_stage == "research"
    assert result.cutoff_date == "2023-09-09"
    assert result.intake_revision == 1
    assert result.pending_fields == ()
    assert result.replayed is False
    projection = service.get_projection(result.run_id)
    assert projection.funding_stage_min == "series_a"
    assert projection.funding_stage_max == "series_c"
    assert projection.funding_window_years == 3
    assert projection.requested_people_per_company == 2
    assert projection.original_specification.startswith("Find recently")
    safe = service.get_safe_projection(result.run_id)
    assert safe.counts == {"requested_companies": 20, "requested_people_per_company": 2}
    assert "original_specification" not in {item.name for item in fields(safe)}
    assert connection.execute(
        "SELECT state FROM prospecting_pipeline_stage_state WHERE run_id=?", (result.run_id,),
    ).fetchone()[0] == "awaiting_adapter"
    assert connection.execute("SELECT count(*) FROM company").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 0
    connection.close()


def test_unknown_scope_is_pending_while_explicit_any_is_not(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "pending.sqlite")
    _seed_campaign(connection)
    pending = service.start_or_resume(_request(
        geography=ScopeSpec("unknown"), sector=ScopeSpec("specific", ("software",)),
    ))
    assert pending.state == "input_pending"
    assert pending.pending_fields == ("geography",)
    assert service.get_latest_projection(CAMPAIGN_ID).run_id == pending.run_id

    ready = service.start_or_resume(_request(
        geography=ScopeSpec("any"), sector=ScopeSpec("any"),
    ))
    assert ready.state == "awaiting_research_adapter"
    assert ready.pending_fields == ()
    assert ready.intake_revision == 2
    assert service.get_latest_projection(CAMPAIGN_ID).run_id == ready.run_id
    connection.close()


def test_exact_request_replays_without_changing_state_and_conflicting_retry_fails(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "replay.sqlite")
    _seed_campaign(connection)
    request_id = str(uuid.uuid4())
    request = _request(request_id=request_id, geography=ScopeSpec("unknown"))
    first = service.start_or_resume(request)

    replay = service.start_or_resume(request)
    assert replay == type(replay)(**{**first.__dict__, "replayed": True})
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_intake").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_run").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_stage_state").fetchone()[0] == 1

    with pytest.raises(PipelineError, match="^request_conflict$"):
        service.start_or_resume(_request(
            request_id=request_id, geography=ScopeSpec("unknown"), people=3,
        ))
    assert service.get_projection(first.run_id).state == "input_pending"
    connection.close()


def test_parameters_are_generic_and_calendar_cutoff_clamps_leap_day(tmp_path: Path) -> None:
    assert calendar_cutoff(date(2024, 2, 29), 1) == date(2023, 2, 28)
    assert calendar_cutoff(date(2024, 2, 29), 4) == date(2020, 2, 29)
    connection, service = _service(tmp_path / "generic.sqlite")
    _seed_campaign(connection)
    request = _request(years=5, people=3, stage_min="seed", stage_max="series_d")
    request = PipelineStartRequest(**{
        **request.__dict__, "as_of_date": "2024-02-29",
        "role_families": ("ai_operations", "chief_of_staff"),
    })
    result = service.start_or_resume(request)
    projection = service.get_projection(result.run_id)
    assert projection.cutoff_date == "2019-02-28"
    assert projection.funding_window_years == 5
    assert projection.requested_people_per_company == 3
    assert (projection.funding_stage_min, projection.funding_stage_max) == ("seed", "series_d")
    assert projection.role_families == ("ai_operations", "chief_of_staff")
    connection.close()


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"funding_stage_min": "series_c", "funding_stage_max": "series_a"}, "invalid_funding_stage_range"),
        ({"funding_window_years": 0}, "invalid_funding_window"),
        ({"requested_people_per_company": 21}, "invalid_people_per_company"),
        ({"role_families": ()}, "invalid_role_families"),
        ({"role_families": ("Operations",)}, "invalid_role_families"),
        ({"role_families": ([],)}, "invalid_role_families"),
        ({"funding_stage_interpretation": []}, "invalid_funding_interpretation"),
        ({"as_of_date": "0001-01-01"}, "invalid_funding_window"),
        ({"geography": ScopeSpec([], ())}, "invalid_geography_scope"),
        ({"geography": ScopeSpec("specific", (chr(0xD800),))}, "invalid_geography"),
        ({"geography": ScopeSpec("specific")}, "invalid_geography"),
        ({"sector": ScopeSpec("any", ("software",))}, "invalid_sector"),
    ],
)
def test_invalid_typed_intake_is_rejected_without_rows(
    tmp_path: Path, change: dict[str, object], code: str,
) -> None:
    connection, service = _service(tmp_path / f"invalid-{code}.sqlite")
    _seed_campaign(connection)
    request = _request()
    request = PipelineStartRequest(**{**request.__dict__, **change})
    with pytest.raises(PipelineError, match=f"^{code}$"):
        service.start_or_resume(request)
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_intake").fetchone()[0] == 0
    connection.close()


def test_concurrent_new_requests_receive_distinct_monotonic_revisions(tmp_path: Path) -> None:
    database = tmp_path / "concurrent.sqlite"
    connection = open_store(database)
    _seed_campaign(connection)
    connection.close()
    requests = (_request(), _request(people=3))

    def start(request: PipelineStartRequest) -> int:
        worker = open_store(database)
        try:
            return PipelineService(worker, now=lambda: STAMP).start_or_resume(request).intake_revision
        finally:
            worker.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        revisions = tuple(pool.map(start, requests))
    assert sorted(revisions) == [1, 2]
    check = open_store(database)
    assert [row[0] for row in check.execute(
        "SELECT intake_revision FROM prospecting_pipeline_intake ORDER BY intake_revision",
    ).fetchall()] == [1, 2]
    check.close()


def test_latest_projection_distinguishes_missing_campaign_from_no_intake(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "latest.sqlite")
    _seed_campaign(connection)
    assert service.get_latest_projection(CAMPAIGN_ID) is None
    with pytest.raises(PipelineError, match="^campaign_missing$"):
        service.get_latest_projection("camp_ffffffffffffffff")
    connection.close()


def test_latest_projection_fails_closed_when_newest_intake_has_no_run(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "latest-corrupt.sqlite")
    _seed_campaign(connection)
    older = service.start_or_resume(_request())
    newest = service.start_or_resume(_request(people=3))
    connection.execute(
        "DELETE FROM prospecting_pipeline_stage_state WHERE run_id=?", (newest.run_id,),
    )
    connection.execute(
        "DELETE FROM prospecting_pipeline_run WHERE run_id=?", (newest.run_id,),
    )

    with pytest.raises(PipelineError, match="^store_state_invalid$"):
        service.get_latest_projection(CAMPAIGN_ID)
    assert service.get_projection(older.run_id).intake_revision == 1
    connection.close()


def test_exact_request_replays_from_a_fresh_connection(tmp_path: Path) -> None:
    database = tmp_path / "fresh-replay.sqlite"
    connection, service = _service(database)
    _seed_campaign(connection)
    request = _request()
    first = service.start_or_resume(request)
    connection.close()

    reopened, resumed = _service(database)
    replay = resumed.start_or_resume(request)
    assert replay.run_id == first.run_id
    assert replay.intake_hash == first.intake_hash
    assert replay.replayed is True
    assert reopened.execute("SELECT count(*) FROM prospecting_pipeline_intake").fetchone()[0] == 1
    reopened.close()


def test_failed_run_insert_rolls_back_intake_and_revision(tmp_path: Path) -> None:
    connection, service = _service(tmp_path / "atomic.sqlite")
    _seed_campaign(connection)
    connection.execute(
        """CREATE TEMP TRIGGER fail_pipeline_run
           BEFORE INSERT ON prospecting_pipeline_run
           BEGIN SELECT RAISE(ABORT, 'forced run failure'); END""",
    )
    request = _request()
    with pytest.raises(sqlite3.IntegrityError, match="forced run failure"):
        service.start_or_resume(request)
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_intake").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_run").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_stage_state").fetchone()[0] == 0

    connection.execute("DROP TRIGGER fail_pipeline_run")
    result = service.start_or_resume(request)
    assert result.intake_revision == 1
    connection.close()
