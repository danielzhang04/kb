from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.funding_research_service import (
    CapturedPage,
    CompanyCapture,
    CoverageInput,
    FundingEventInput,
    FundingResearchError,
    FundingResearchRequest,
    FundingResearchService,
)
from scripts.prospecting import source_capture as capture_module
from scripts.prospecting.pipeline_service import (
    PipelineService,
    PipelineStartRequest,
    ScopeSpec,
)
from scripts.prospecting.store import open_store


STAMP = "2026-09-10T12:00:00Z"
CAMPAIGN_ID = "camp_aaaabbbbccccdddd"
POLICY_HASH = "a" * 64


def _seed(
    connection: sqlite3.Connection, *, interpretation: str = "latest_known",
    desired: int = 2, as_of: str = "2026-09-09", years: int = 3,
):
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
    started = PipelineService(connection, now=lambda: STAMP).start_or_resume(PipelineStartRequest(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CAMPAIGN_ID, as_of,
        "series_a", "series_c", years, interpretation, ScopeSpec("any"), ScopeSpec("any"),
        desired, 2, ("operations",), "Synthetic funding research", "Coffee chat",
    ))
    return started


def _capture(root: Path, name: str, text: str) -> str:
    folder = root / "snapshots" / "browser-acceptance"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(text, encoding="utf-8")
    return f"browser-acceptance/{name}"


def _candidate(
    root: Path, *, name: str = "Nimbus Systems", host: str = "nimbus.invalid",
    stage: str = "series_b", announced: str = "2025-05-01",
    primary_kind: str = "issuer", coverage_status: str = "found",
    query: str = "Nimbus Systems funding", location: str | None = "United States",
    sector: str | None = "software",
) -> CompanyCapture:
    event_text = f"{name} announced {stage} on {announced}."
    event_ref = _capture(root, f"{host}-event.txt", event_text)
    coverage_ref = _capture(root, f"{host}-coverage.txt", f"Search results for {query}.")
    return CompanyCapture(
        name, f"https://{host}/", location, sector,
        (
            CapturedPage(event_ref, f"https://{host}/funding", primary_kind, STAMP),
            CapturedPage(
                coverage_ref, f"https://search.invalid/{host}", "search_coverage", STAMP,
                CoverageInput(query, STAMP, coverage_status, 1 if coverage_status == "found" else 0, 20),
            ),
        ),
        (FundingEventInput(0, stage, announced, event_text),),
    )


def _request(started, candidate: CompanyCapture, *, request_id: str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", predecessor=None):
    return FundingResearchRequest(
        request_id, started.run_id, started.intake_hash,
        None if predecessor is None else predecessor.batch_id,
        None if predecessor is None else predecessor.batch_hash,
        (candidate,),
    )


def test_import_is_atomic_source_bound_provisional_and_safe(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)

    result = service.import_and_classify(_request(started, _candidate(tmp_path)))

    assert result.state == "awaiting_qualification_factcheck"
    assert result.counts == {
        "candidates": 1, "provisional_matches": 1, "provisional_excluded": 0,
        "unknown": 0, "collisions": 0, "provisional_shortfall": 1,
    }
    projection = service.get_projection(started.run_id)
    assert projection is not None
    assert projection.companies[0].rule_outcome == "provisional_match"
    assert projection.companies[0].latest_stage == "series_b"
    assert {item.source_kind for item in projection.companies[0].sources} == {"issuer", "search_coverage"}
    assert all(item.source_url.startswith("https://") for item in projection.companies[0].sources)
    assert connection.execute("SELECT source_lane FROM company").fetchone()[0] == "manual"
    assert connection.execute("SELECT count(*) FROM source_snapshot").fetchone()[0] == 2
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 2
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    safe = service.get_safe_projection(started.run_id)
    assert safe is not None and safe.counts["provisional_matches"] == 1
    assert "Nimbus" not in repr(safe)
    connection.close()


def test_exact_replay_fresh_connection_and_conflict(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started = _seed(connection)
    request = _request(started, _candidate(tmp_path))
    first = FundingResearchService(connection, now=lambda: STAMP).import_and_classify(request)
    connection.close()

    reopened = open_store(database)
    service = FundingResearchService(reopened, now=lambda: STAMP)
    replay = service.import_and_classify(request)
    assert replay.replayed is True and replay.batch_hash == first.batch_hash
    with pytest.raises(FundingResearchError, match="^request_conflict$"):
        service.import_and_classify(replace(request, candidates=(replace(request.candidates[0], sector="finance"),)))
    assert reopened.execute("SELECT count(*) FROM prospecting_funding_batch").fetchone()[0] == 1
    reopened.close()


def test_replacement_batch_requires_exact_predecessor_and_reports_shortfall(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection, desired=8)
    service = FundingResearchService(connection, now=lambda: STAMP)
    first = service.import_and_classify(_request(started, _candidate(tmp_path)))
    with pytest.raises(FundingResearchError, match="^predecessor_conflict$"):
        service.import_and_classify(_request(
            started, _candidate(tmp_path, name="Orbit Labs", host="orbit.invalid", query="Orbit Labs funding"),
            request_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ))
    second = service.import_and_classify(_request(
        started, _candidate(tmp_path, name="Orbit Labs", host="orbit.invalid", query="Orbit Labs funding"),
        request_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc", predecessor=first,
    ))
    assert second.counts["candidates"] == 1
    assert second.counts["provisional_shortfall"] == 7
    connection.close()


@pytest.mark.parametrize(
    ("interpretation", "stage", "outcome", "reason"),
    (
        ("latest_known", "series_d", "provisional_excluded", "later_stage_known"),
        ("any_eligible_within_window", "series_d", "provisional_excluded", "no_eligible_event_in_window"),
        ("latest_known", "series_b", "provisional_match", "latest_event_eligible_with_current_coverage"),
    ),
)
def test_stage_date_pair_and_interpretation(
    tmp_path: Path, interpretation: str, stage: str, outcome: str, reason: str,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection, interpretation=interpretation)
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, _candidate(tmp_path, stage=stage)))
    company = service.get_projection(started.run_id).companies[0]
    assert (company.rule_outcome, company.reason_codes, company.latest_stage) == (outcome, (reason,), stage)
    connection.close()


def test_any_eligible_keeps_actual_eligible_pair_despite_later_d(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection, interpretation="any_eligible_within_window")
    base = _candidate(tmp_path)
    later_text = "Nimbus Systems announced series_d on 2026-01-01."
    later_ref = _capture(tmp_path, "nimbus-later.txt", later_text)
    candidate = replace(
        base,
        pages=base.pages + (CapturedPage(later_ref, "https://nimbus.invalid/later", "issuer", STAMP),),
        events=base.events + (FundingEventInput(2, "series_d", "2026-01-01", later_text),),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    company = service.get_projection(started.run_id).companies[0]
    assert (company.rule_outcome, company.latest_stage, company.latest_announced_at) == (
        "provisional_match", "series_d", "2026-01-01",
    )
    connection.close()


@pytest.mark.parametrize(
    ("primary_kind", "coverage_status", "expected"),
    (
        ("independent_report", "found", "unknown"),
        ("participating_investor", "empty", "provisional_match"),
        ("issuer", "blocked", "unknown"),
    ),
)
def test_primary_authority_and_honest_coverage(
    tmp_path: Path, primary_kind: str, coverage_status: str, expected: str,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    candidate = _candidate(tmp_path, primary_kind=primary_kind, coverage_status=coverage_status)
    service.import_and_classify(_request(started, candidate))
    assert service.get_projection(started.run_id).companies[0].rule_outcome == expected
    connection.close()


def test_conflicting_funding_chronology_is_unknown(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    base = _candidate(tmp_path, stage="series_c", announced="2025-01-01")
    later_text = "Nimbus Systems announced series_a on 2025-06-01."
    later_ref = _capture(tmp_path, "nimbus-conflict.txt", later_text)
    candidate = replace(
        base,
        pages=base.pages + (CapturedPage(later_ref, "https://nimbus.invalid/conflict", "issuer", STAMP),),
        events=base.events + (FundingEventInput(2, "series_a", "2025-06-01", later_text),),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    company = service.get_projection(started.run_id).companies[0]
    assert company.rule_outcome == "unknown"
    assert company.reason_codes == ("conflicting_funding_history",)
    connection.close()


def test_same_date_conflicting_stages_are_unknown(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    base = _candidate(tmp_path, stage="series_a", announced="2025-01-01")
    conflict_text = "Nimbus Systems announced series_b on 2025-01-01."
    conflict_ref = _capture(tmp_path, "nimbus-tie.txt", conflict_text)
    candidate = replace(
        base,
        pages=base.pages + (CapturedPage(conflict_ref, "https://nimbus.invalid/tie", "issuer", STAMP),),
        events=base.events + (FundingEventInput(2, "series_b", "2025-01-01", conflict_text),),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    assert service.get_projection(started.run_id).companies[0].reason_codes == (
        "conflicting_funding_history",
    )
    connection.close()


@pytest.mark.parametrize("primary_first", (True, False))
def test_same_event_pair_uses_primary_support_independent_of_page_order(
    tmp_path: Path, primary_first: bool,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    event_text = "Nimbus Systems announced series_b on 2025-05-01."
    primary_ref = _capture(tmp_path, "pair-primary.txt", event_text)
    report_ref = _capture(tmp_path, "pair-report.txt", event_text)
    coverage_ref = _capture(tmp_path, "pair-coverage.txt", "Nimbus Systems funding results.")
    event_pages = (
        CapturedPage(primary_ref, "https://nimbus.invalid/funding", "issuer", STAMP),
        CapturedPage(report_ref, "https://report.invalid/nimbus", "independent_report", STAMP),
    )
    if not primary_first:
        event_pages = tuple(reversed(event_pages))
    pages = event_pages + (
        CapturedPage(
            coverage_ref, "https://search.invalid/nimbus", "search_coverage", STAMP,
            CoverageInput("Nimbus Systems funding", STAMP, "found", 1, 20),
        ),
    )
    candidate = CompanyCapture(
        "Nimbus Systems", "https://nimbus.invalid/", "United States", "software", pages,
        (
            FundingEventInput(0, "series_b", "2025-05-01", event_text),
            FundingEventInput(1, "series_b", "2025-05-01", event_text),
        ),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    company = service.get_projection(started.run_id).companies[0]
    assert (company.rule_outcome, company.latest_stage, company.latest_announced_at) == (
        "provisional_match", "series_b", "2025-05-01",
    )
    connection.close()


def test_calendar_cutoff_is_inclusive_for_leap_day_intake(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection, as_of="2024-02-29", years=3)
    candidate = _candidate(tmp_path, announced="2021-02-28")
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    assert service.get_projection(started.run_id).companies[0].rule_outcome == "provisional_match"
    connection.close()


def test_coverage_scope_uses_token_boundaries(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    candidate = _candidate(
        tmp_path, name="AI", host="ai.invalid", query="retail funding coverage",
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    assert service.get_projection(started.run_id).companies[0].reason_codes == (
        "current_coverage_missing",
    )
    connection.close()


def test_run_specific_candidate_pool_cap_is_output_multiplier(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection, desired=1)
    candidates = tuple(
        _candidate(
            tmp_path, name=f"Synthetic Company {name}", host=f"{name}.invalid",
            query=f"Synthetic Company {name} funding",
        )
        for name in ("alpha", "bravo", "charlie", "delta")
    )
    request = FundingResearchRequest(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd", started.run_id,
        started.intake_hash, None, None, candidates,
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    with pytest.raises(FundingResearchError, match="^candidate_pool_too_large$"):
        service.import_and_classify(request)
    assert connection.execute("SELECT count(*) FROM prospecting_funding_batch").fetchone()[0] == 0
    connection.close()


def test_stale_capture_refuses_even_with_well_ordered_search_timestamp(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    candidate = _candidate(tmp_path)
    stale = "2026-07-01T12:00:00Z"
    pages = tuple(replace(page, captured_at=stale) for page in candidate.pages)
    pages = (pages[0], replace(pages[1], coverage=replace(pages[1].coverage, searched_at=stale)))
    candidate = replace(candidate, pages=pages)
    service = FundingResearchService(connection, now=lambda: STAMP)
    with pytest.raises(FundingResearchError, match="^source_stale$"):
        service.import_and_classify(_request(started, candidate))
    assert connection.execute("SELECT count(*) FROM source_snapshot").fetchone()[0] == 0
    connection.close()


def test_coverage_search_cannot_postdate_its_capture(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    candidate = _candidate(tmp_path)
    earlier_capture = "2026-09-09T12:00:00Z"
    coverage_page = replace(candidate.pages[1], captured_at=earlier_capture)
    candidate = replace(candidate, pages=(candidate.pages[0], coverage_page))
    with pytest.raises(FundingResearchError, match="^invalid_coverage$"):
        FundingResearchService(connection, now=lambda: STAMP).import_and_classify(
            _request(started, candidate),
        )
    assert connection.execute("SELECT count(*) FROM prospecting_funding_batch").fetchone()[0] == 0
    connection.close()


@pytest.mark.parametrize(
    "url",
    ("https://exa mple.invalid/", "https://example.invalid\\other/", "https://a..invalid/"),
)
def test_ambiguous_source_hosts_are_refused(tmp_path: Path, url: str) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    candidate = _candidate(tmp_path)
    candidate = replace(
        candidate, pages=(replace(candidate.pages[0], source_url=url), candidate.pages[1]),
    )
    with pytest.raises(FundingResearchError, match="^invalid_source_url$"):
        FundingResearchService(connection, now=lambda: STAMP).import_and_classify(
            _request(started, candidate),
        )
    connection.close()


def test_identity_conflict_retains_only_opaque_collision_snapshots(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("co_existing", "Nimbus Systems", "https://different.invalid/", "manual", "existing"),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, _candidate(tmp_path)))
    company = service.get_projection(started.run_id).companies[0]
    assert company.rule_outcome == "collision_refused" and company.company_id is None
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 0
    assert connection.execute(
        "SELECT count(*) FROM prospecting_funding_source WHERE observation_id IS NOT NULL",
    ).fetchone()[0] == 0
    assert all(str(row[0]).startswith("pfrr_") for row in connection.execute("SELECT entity_id FROM source_snapshot"))
    connection.close()


def test_changed_intake_policy_and_source_fail_closed(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    request = _request(started, _candidate(tmp_path))
    service.import_and_classify(request)
    stored = connection.execute("SELECT body_ref FROM source_snapshot ORDER BY snapshot_id LIMIT 1").fetchone()[0]
    (tmp_path / "snapshots" / stored).write_text("changed", encoding="utf-8")
    with pytest.raises(FundingResearchError, match="^source_changed$"):
        service.get_projection(started.run_id)
    connection.execute("UPDATE campaign SET policy_hash=? WHERE campaign_id=?", ("b" * 64, CAMPAIGN_ID))
    with pytest.raises(FundingResearchError, match="^store_state_invalid$"):
        service.get_projection(started.run_id)
    connection.close()


def test_shared_p15_integrity_validation_rejects_mutated_workflow_binding(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    connection.execute(
        "UPDATE prospecting_pipeline_run SET workflow_hash=? WHERE run_id=?",
        ("f" * 64, started.run_id),
    )
    service = FundingResearchService(connection, now=lambda: STAMP)
    with pytest.raises(FundingResearchError, match="^store_state_invalid$"):
        service.import_and_classify(_request(started, _candidate(tmp_path)))
    assert connection.execute("SELECT count(*) FROM prospecting_funding_batch").fetchone()[0] == 0
    connection.close()


def test_invalid_paths_pool_and_transaction_roll_back_without_imported_files(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    candidate = _candidate(tmp_path)
    with pytest.raises(FundingResearchError, match="^invalid_body_ref$"):
        service.import_and_classify(_request(started, replace(
            candidate, pages=(replace(candidate.pages[0], body_ref="../outside.txt"), candidate.pages[1]),
        )))
    connection.execute(
        """CREATE TEMP TRIGGER abort_funding_source BEFORE INSERT ON prospecting_funding_source
             BEGIN SELECT RAISE(ABORT,'synthetic_abort'); END""",
    )
    with pytest.raises(FundingResearchError, match="^store_state_invalid$"):
        service.import_and_classify(_request(started, candidate))
    for table in ("prospecting_funding_batch", "prospecting_funding_company", "source_snapshot", "source_observation"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    imported = tmp_path / "snapshots" / "funding-research"
    assert not imported.exists() or not tuple(imported.iterdir())
    connection.close()


def test_direct_snapshot_child_is_supported_and_hardlink_is_refused(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    candidate = _candidate(tmp_path)
    direct = tmp_path / "snapshots" / "direct-source.txt"
    direct.write_text("Nimbus Systems announced series_b on 2025-05-01.", encoding="utf-8")
    direct_page = replace(candidate.pages[0], body_ref="direct-source.txt")
    candidate = replace(candidate, pages=(direct_page, candidate.pages[1]))
    service = FundingResearchService(connection, now=lambda: STAMP)
    service.import_and_classify(_request(started, candidate))
    assert service.get_projection(started.run_id).provisional_match_count == 1
    connection.close()

    second_root = tmp_path / "hardlink-case"
    second = open_store(second_root / "store.sqlite")
    second_started = _seed(second)
    linked_candidate = _candidate(second_root)
    source = second_root / "snapshots" / linked_candidate.pages[0].body_ref
    alias = source.with_name("owned-alias.txt")
    try:
        alias.hardlink_to(source)
    except OSError:
        pytest.skip("hardlinks unavailable")
    with pytest.raises(FundingResearchError, match="^source_changed$"):
        FundingResearchService(second, now=lambda: STAMP).import_and_classify(
            _request(second_started, linked_candidate),
        )
    second.close()


@pytest.mark.parametrize("replace_final", (True, False))
def test_copy_failure_never_deletes_a_foreign_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, replace_final: bool,
) -> None:
    root = tmp_path / "snapshots"
    root.mkdir()
    connection = open_store(tmp_path / "store.sqlite")
    service = FundingResearchService(connection, now=lambda: STAMP)
    original_link = capture_module.os.link
    final_path: Path | None = None

    def fail_after_link(source, target):
        nonlocal final_path
        original_link(source, target)
        final_path = Path(target)
        final_path.unlink()
        if replace_final:
            final_path.write_text("foreign replacement", encoding="utf-8")

    monkeypatch.setattr(capture_module.os, "link", fail_after_link)
    with pytest.raises(FundingResearchError, match="^source_changed$"):
        service._copy_snapshot(root, "snap_syntheticcopy", b"synthetic input", [])
    assert final_path is not None
    if replace_final:
        assert final_path.read_text(encoding="utf-8") == "foreign replacement"
    else:
        assert not final_path.exists()
    assert not (root / "funding-research" / ".snap_syntheticcopy.tmp").exists()
    connection.close()
