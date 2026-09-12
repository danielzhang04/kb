"""Synthetic P6 coverage for self-contained email-first firm selection."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sqlite3

from scripts.prospecting.executor import Executor
from scripts.prospecting.operator import cli, vendors
from scripts.prospecting.operator.fill import fill_campaign
from scripts.prospecting.store import ContactPoint, insert_contact_point, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


FIXTURES = Path("orgs/prospecting/fixtures/vendor/snov")
SYNTHETIC = legacy_fixture("test_operator_fill")


def _fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _ask() -> str:
    return "intent:networking lane:manual companies-count:1 people-count:2 title:director ask:relationship credits:10"


class _Response:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *unused: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def _prepare(tmp_path: Path, monkeypatch) -> tuple[Path, str]:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("SNOV_CLIENT_ID", "synthetic-client")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "synthetic-secret")
    campaign_id = str(cli.campaign_new(_ask(), open_store_fn=lambda: open_store(store))["campaign_id"])
    connection = open_store(store)
    connection.execute(
        """INSERT INTO company(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane,dedupe_key)
           VALUES('cmp_0000000000000001','Alpha Synthetic','https://alpha.test',NULL,NULL,NULL,NULL,'manual','alpha')"""
    )
    connection.commit()
    root = tmp_path / "kb-prospecting"
    root.mkdir()
    (root / "company-domains.csv").write_text("name,domain\nAlpha Synthetic,alpha.test\n", encoding="utf-8")
    assert cli.main(["vendors", "attach", "--providers", "snov"]) == 0

    page = {
        "data": [
            {"first_name": "Avery", "last_name": "Synthetic", "position": "Director", "source_page": "https://profiles.test/avery", "search_emails_start": "https://api.snov.io/v2/prospect/avery/search-emails/start"},
            {"first_name": "Morgan", "last_name": "Synthetic", "position": "Director", "source_page": "https://profiles.test/morgan", "search_emails_start": "https://api.snov.io/v2/prospect/morgan/search-emails/start"},
        ],
        "meta": {"task_hash": "domain-task"}, "links": {}, "status": "completed",
    }
    monkeypatch.setattr(vendors, "_snov_domain_transport", lambda **unused: page)

    def transport(request: object, timeout: int) -> _Response:
        url = str(getattr(request, "full_url", ""))
        if url.endswith("/v1/oauth/access_token"):
            return _Response(b'{"access_token":"synthetic"}')
        if url.endswith("/search-emails/start"):
            person = url.rstrip("/").split("/")[-3]
            return _Response(json.dumps({"meta": {"task_hash": person}, "links": {"result": f"https://api.snov.io/v2/prospect/email-search/result/{person}"}}).encode())
        person = url.rstrip("/").split("/")[-1]
        return _Response(json.dumps({"data": [{"email": f"{person}@alpha.test", "status": "valid"}], "status": "completed"}).encode())

    monkeypatch.setattr(vendors.urllib.request, "urlopen", transport)
    connection.close()
    return store, campaign_id


def test_fill_fresh_store_discovers_drains_searches_and_delivers(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    try:
        summary = cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        assert summary.counts() == {
            "firms_met": 1, "firms_short": 0, "firms_substituted": 0,
            "people_delivered": 2, "searches_run": 2, "credits": 3,
            "firms_discovered": 1, "candidates_found": 2, "shortfall_reason": "none",
            "firms_partial": 0, "firms_refused": 0, "domains_backfilled": 0,
            "profiles_skipped_untyped": 0,
        }
        connection = open_store(store)
        assert connection.execute("SELECT COUNT(*) FROM snov_domain_page").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM contact_point WHERE state='valid'").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM exec_request WHERE state='queued'").fetchone()[0] == 1
    finally:
        connection.close()


def test_fill_resume_after_partial_drain_does_not_rebuy(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    connection = open_store(store)

    def drain_one() -> None:
        executor = Executor(connection)
        vendors.attach_vendors(executor, now="2026-09-04T00:00:00Z", providers=("snov",))
        assert executor.process_one()

    try:
        first = fill_campaign(connection, campaign_id, target_per_firm=2, max_candidates_per_firm=2, max_rounds=2, execute=drain_one, at="2026-09-04T00:00:00Z")
        assert first.firms_short == 1
        before = connection.execute("SELECT COUNT(*) FROM exec_request WHERE operation='vendor_lookup'").fetchone()[0]

        def drain_all() -> None:
            executor = Executor(connection)
            vendors.attach_vendors(executor, now="2026-09-04T00:01:00Z", providers=("snov",))
            while executor.process_one():
                pass

        resumed = fill_campaign(connection, campaign_id, target_per_firm=2, max_candidates_per_firm=2, execute=drain_all, at="2026-09-04T00:01:00Z")
        after = connection.execute("SELECT COUNT(*) FROM exec_request WHERE operation='vendor_lookup'").fetchone()[0]
        assert before == after == 2
        assert resumed.firms_met == 1
    finally:
        connection.close()


def test_fill_re_evaluates_a_previously_short_firm(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    try:
        summary = cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        assert summary.firms_met == 1
        connection = open_store(store)
        company_id, person_id = connection.execute("SELECT company_id,person_id FROM fill_person ORDER BY person_id LIMIT 1").fetchone()
        connection.execute("UPDATE fill_firm SET status='short',shortfall_reason='candidate_exhausted' WHERE campaign_id=?", (campaign_id,))
        connection.execute("DELETE FROM contact_point")
        insert_contact_point(connection, ContactPoint("cp_recovered", str(person_id), str(company_id), SYNTHETIC["recovered_email"], "manual", "fixture", None, None, "valid", 0.9, 0))
        connection.commit()
        again = fill_campaign(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=2, at="2026-09-04T00:02:00Z")
        assert again.firms_met == 1
        assert connection.execute("SELECT status FROM fill_firm WHERE campaign_id=?", (campaign_id,)).fetchone()[0] == "met"
    finally:
        connection.close()


def test_fill_page_budget_exhausts_after_the_allowed_unfiltered_page(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    calls = []

    def domain_transport(**kwargs):
        calls.append(kwargs)
        assert set(kwargs) == {"domain", "page"}
        page = _fixture(f"v2-prospects-unfiltered-page{kwargs['page']}.json")
        page["data"][0]["position"] = "Director"
        return page

    monkeypatch.setattr(vendors, "_snov_domain_transport", domain_transport)
    try:
        summary = cli.fill_run(
            campaign_id, target_per_firm=2, max_candidates_per_firm=6,
            max_pages_per_firm=1, open_store_fn=lambda: open_store(store),
        )
        connection = open_store(store)
        assert connection.execute("SELECT count(*) FROM snov_domain_page").fetchone()[0] == 1
        assert tuple(connection.execute("SELECT status,shortfall_reason FROM fill_firm").fetchone()) == ("short", "candidate_exhausted")
        assert summary.searches_run == 1
        assert all("positions" not in request for request in calls)
    finally:
        connection.close()


def test_fill_empty_discovery_is_converged_no_candidates(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_snov_domain_transport", lambda **kwargs: _fixture("v2-prospects-empty.json"))
    try:
        first = cli.fill_run(campaign_id, target_per_firm=1, open_store_fn=lambda: open_store(store))
        second = cli.fill_run(campaign_id, target_per_firm=1, open_store_fn=lambda: open_store(store))
        connection = open_store(store)
        assert tuple(connection.execute("SELECT status,shortfall_reason FROM fill_firm").fetchone()) == ("short", "no_candidates")
        assert second.domains_backfilled == 0
        assert second.counts() == {**first.counts(), "domains_backfilled": 0}
        assert second.searches_run == 0
        assert second.shortfall_reason != "discovery_pending"
    finally:
        connection.close()


def test_fill_reserve_firms_get_typed_company_ids(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    reserve_firms = tmp_path / "reserve-firms.csv"
    reserve_firms.write_text(
        "kind,linkedin_url,name\n"
        "company,https://professional-network.invalid/organization/reserve-synthetic,Reserve Synthetic\n",
        encoding="utf-8",
    )
    (tmp_path / "kb-prospecting" / "company-domains.csv").write_text(
        "name,domain\nAlpha Synthetic,alpha.test\nReserve Synthetic,reserve.test\n", encoding="utf-8",
    )
    connection = None
    try:
        cli.fill_run(
            campaign_id, target_per_firm=1, max_candidates_per_firm=2, reserve_firms=reserve_firms,
            open_store_fn=lambda: open_store(store),
        )
        connection = open_store(store)
        company_id = str(connection.execute(
            "SELECT company_id FROM company WHERE name='Reserve Synthetic'",
        ).fetchone()[0])
        assert re.fullmatch(r"cmp_[0-9a-f]{16}", company_id)
    finally:
        if connection is not None:
            connection.close()


def test_fill_skips_untyped_profile_ids_without_aborting(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    connection = None
    try:
        cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        connection = open_store(store)
        person_id = str(connection.execute(
            "SELECT person_id FROM fill_person WHERE campaign_id=? ORDER BY person_id LIMIT 1", (campaign_id,),
        ).fetchone()[0])
        untyped_id = "123e4567-e89b-12d3-a456-426614174000"
        connection.execute("DELETE FROM exec_request WHERE operation='fetch_snapshot'")
        connection.execute(
            """INSERT INTO company(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane,dedupe_key)
               VALUES(?, 'Untyped Synthetic', 'https://untyped.test', NULL, NULL, NULL, NULL, 'manual', 'untyped')""",
            (untyped_id,),
        )
        connection.execute("UPDATE employment SET company_id=? WHERE person_id=?", (untyped_id, person_id))
        connection.execute(
            "UPDATE fill_person SET company_id=? WHERE campaign_id=? AND person_id=?",
            (untyped_id, campaign_id, person_id),
        )
        connection.execute(
            """INSERT INTO fill_firm(campaign_id,company_id,target_per_firm,max_candidates,status,shortfall_reason,updated_at)
               VALUES(?,?,?,?,?,?,?)""",
            (campaign_id, untyped_id, 1, 2, "met", None, "2026-09-04T00:06:00Z"),
        )
        connection.commit()

        summary = fill_campaign(
            connection, campaign_id, target_per_firm=1, max_candidates_per_firm=2,
            at="2026-09-04T00:06:00Z",
        )
        assert summary.profiles_skipped_untyped == 1
        assert connection.execute("SELECT COUNT(*) FROM exec_request WHERE operation='fetch_snapshot'").fetchone()[0] == 1
    finally:
        if connection is not None:
            connection.close()


def test_fill_backfills_domains_before_profile_queue_on_converged_pass(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    try:
        cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        connection = open_store(store)
        alpha_id = "cmp_0000000000000001"
        beta_id = "cmp_0000000000000002"
        connection.execute("DELETE FROM exec_request WHERE operation='fetch_snapshot'")
        connection.execute("DELETE FROM contact_point WHERE person_id != (SELECT person_id FROM contact_point ORDER BY person_id LIMIT 1)")
        connection.execute("UPDATE company SET website_url=NULL WHERE company_id=?", (alpha_id,))
        connection.execute(
            """INSERT INTO company(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane,dedupe_key)
               VALUES(?, 'Beta Synthetic', NULL, NULL, NULL, NULL, NULL, 'manual', 'beta')""",
            (beta_id,),
        )
        run_id = "camp_0000000000000003"
        connection.execute(
            """INSERT INTO finder_run(
                   finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,
                   state,started_at,updated_at
               ) VALUES(?,?,?,?,?,'running',?,?)""",
            (run_id, campaign_id, connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0], 1, 1,
             "2026-09-04T00:04:00Z", "2026-09-04T00:04:00Z"),
        )
        connection.execute(
            """INSERT INTO fill_discovery(campaign_id,company_id,finder_run_id,max_candidates,next_page,exhausted,updated_at)
               VALUES(?,?,?,?,NULL,1,?)""",
            (campaign_id, beta_id, run_id, 1, "2026-09-04T00:04:00Z"),
        )
        connection.commit()

        first = fill_campaign(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=2, at="2026-09-04T00:04:00Z")
        assert first.domains_backfilled == 1
        assert connection.execute("SELECT website_url FROM company WHERE company_id=?", (alpha_id,)).fetchone()[0] == "https://alpha.test"
        assert connection.execute("SELECT website_url FROM company WHERE company_id=?", (beta_id,)).fetchone()[0] is None
        assert connection.execute("SELECT count(*) FROM exec_request WHERE operation='fetch_snapshot'").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM snov_domain_page").fetchone()[0] == 1

        second = fill_campaign(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=2, at="2026-09-04T00:05:00Z")
        assert second.domains_backfilled == 0
        assert connection.execute("SELECT count(*) FROM exec_request WHERE operation='fetch_snapshot'").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM snov_domain_page").fetchone()[0] == 1
    finally:
        connection.close()


def test_fill_requeues_discovery_after_snov_account_ceiling_is_raised(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    connection = open_store(store)
    try:
        assert cli.main([
            "vendors", "attach", "--providers", "snov", "--snov-account-credit-ceiling", "0",
        ]) == 0
        first = fill_campaign(connection, campaign_id, target_per_firm=1, max_rounds=1)
        assert first.firms_refused == 1
        assert tuple(connection.execute(
            "SELECT next_page,exhausted FROM fill_discovery WHERE campaign_id=?", (campaign_id,)
        ).fetchone()) == (1, 0)
        assert tuple(connection.execute(
            "SELECT status,shortfall_reason FROM fill_firm WHERE campaign_id=?", (campaign_id,)
        ).fetchone()) == ("short", "snov_account_credit_ceiling")
    finally:
        connection.close()

    assert cli.main([
        "vendors", "attach", "--providers", "snov", "--snov-account-credit-ceiling", "1000",
    ]) == 0
    connection = open_store(store)
    try:
        second = fill_campaign(connection, campaign_id, target_per_firm=1, max_rounds=1)
        assert second.shortfall_reason == "discovery_pending"
        assert tuple(connection.execute(
            "SELECT request.state FROM snov_domain_page AS page JOIN fill_discovery AS discovery "
            "ON discovery.finder_run_id=page.finder_run_id JOIN exec_request AS request "
            "ON request.request_id=page.request_id WHERE discovery.campaign_id=?", (campaign_id,)
        ).fetchone()) == ("queued",)
    finally:
        connection.close()


def test_fill_counts_confident_people_from_partial_firms(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    page = {
        "data": [
            {"first_name": "Avery", "last_name": "Synthetic", "position": "Director", "source_page": "https://profiles.test/avery", "search_emails_start": "https://api.snov.io/v2/prospect/avery/search-emails/start"},
            {"first_name": "Morgan", "last_name": "Synthetic", "position": "Director", "source_page": "https://profiles.test/morgan", "search_emails_start": "https://api.snov.io/v2/prospect/morgan/search-emails/start"},
        ], "meta": {"task_hash": "partial-domain-task"}, "links": {}, "status": "completed",
    }
    monkeypatch.setattr(vendors, "_snov_domain_transport", lambda **kwargs: page)

    def email_transport(request: object, timeout: int) -> _Response:
        url = str(getattr(request, "full_url", ""))
        if url.endswith("/v1/oauth/access_token"):
            return _Response(b'{"access_token":"synthetic"}')
        if url.endswith("/search-emails/start"):
            person = url.rstrip("/").split("/")[-3]
            return _Response(json.dumps({"meta": {"task_hash": person}, "links": {"result": f"https://api.snov.io/v2/prospect/email-search/result/{person}"}}).encode())
        person = url.rstrip("/").split("/")[-1]
        records = [] if person == "morgan" else [{"email": SYNTHETIC["avery_email"], "status": "valid"}]
        return _Response(json.dumps({"data": records, "status": "completed"}).encode())

    monkeypatch.setattr(vendors.urllib.request, "urlopen", email_transport)
    try:
        summary = cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        assert summary.people_delivered == 1
        assert summary.firms_partial == 1
        assert summary.firms_short == 1
        assert summary.firms_met == 0
        connection = open_store(store)
        assert connection.execute("SELECT count(*) FROM exec_request WHERE operation='fetch_snapshot' AND state='queued'").fetchone()[0] == 1
        connection.close()
    finally:
        connection = open_store(store)
        connection.close()


def test_fill_substitutes_existing_selected_title_excluded_by_current_policy(tmp_path: Path, monkeypatch) -> None:
    store, campaign_id = _prepare(tmp_path, monkeypatch)
    try:
        cli.fill_run(campaign_id, target_per_firm=2, max_candidates_per_firm=2, open_store_fn=lambda: open_store(store))
        connection = open_store(store)
        person_id = str(connection.execute("SELECT person_id FROM employment WHERE title='Director' ORDER BY person_id LIMIT 1").fetchone()[0])
        connection.execute("UPDATE employment SET title='IT Director' WHERE person_id=?", (person_id,))
        connection.commit()
        summary = fill_campaign(
            connection, campaign_id, target_per_firm=2, max_candidates_per_firm=2,
            at="2026-09-04T00:03:00Z",
        )
        assert summary.firms_short == 1
        assert tuple(connection.execute(
            "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?", (campaign_id, person_id),
        ).fetchone()) == (1,)
        assert tuple(connection.execute(
            "SELECT status,shortfall_reason FROM fill_firm WHERE campaign_id=?", (campaign_id,),
        ).fetchone()) == ("short", "candidate_exhausted")
    finally:
        connection.close()
