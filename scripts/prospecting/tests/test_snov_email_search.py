from __future__ import annotations

import json
from pathlib import Path

from scripts.prospecting.executor import Executor
from scripts.prospecting.operator import vendors
from scripts.prospecting.operator.vendors import attach_vendors
from scripts.prospecting.store import Company, Person, insert_company, insert_person, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


AT = "2026-09-04T00:00:00Z"
HASH = "a" * 64
FIXTURES = Path("orgs/prospecting/fixtures/vendor/snov")
SYNTHETIC = legacy_fixture("test_snov_email_search")


def _fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _store(tmp_path: Path):
    connection = open_store(tmp_path / "store.sqlite")
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)", ("sender", "Synthetic", None, "Synthetic", "Synthetic", "Synthetic", "[]"))
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("camp_0000000000000001", "networking", "sender", "{}", "relationship", 15, "warm", "fixture", "[]", "00:00-23:59", "UTC", 25, 6, 2, "T0", "sender", "{}", 10, "active", HASH),
    )
    insert_company(connection, Company("cmp_0000000000000001", "Alpha Synthetic", None, None, None, None, None, "manual", "alpha"))
    insert_person(connection, Person("per_0000000000000001", "Avery", "Avery Synthetic", None, None, None, "manual", "avery"))
    connection.execute(
        "INSERT INTO snov_prospect VALUES(?,?,?,?)",
        ("per_0000000000000001", "cmp_0000000000000001", "https://profiles.test/avery", "https://api.snov.io/v2/prospect/avery/search-emails/start"),
    )
    connection.commit()
    return connection


class _Response:
    def __init__(self, value): self.value = value
    def read(self): return json.dumps(self.value).encode()
    def __enter__(self): return self
    def __exit__(self, *args): return False


def _queue(executor, adapter):
    adapter.queue(
        executor.connection, campaign_id="camp_0000000000000001", person_id="per_0000000000000001",
        policy_hash=HASH, request_id="req_0000000000000001", now=AT,
    )


def test_v2_email_search_polls_to_completion_and_persists_statuses(tmp_path, monkeypatch):
    connection = _store(tmp_path)
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    monkeypatch.setattr(vendors.time, "sleep", lambda _seconds: None)
    calls = []
    values = iter([{"success": True, "access_token": "token-private", "token_type": "Bearer", "expires_in": 3600}, _fixture("email-search-start.json"), _fixture("email-search-in-progress.json"), _fixture("email-search-complete.json")])
    def urlopen(request, timeout):
        calls.append(request.full_url)
        return _Response(next(values))
    monkeypatch.setattr(vendors.urllib.request, "urlopen", urlopen)
    executor = Executor(connection)
    adapter = attach_vendors(executor, now=AT, providers=("snov",))["snov"]
    _queue(executor, adapter)
    assert executor.process_one()
    assert [tuple(row) for row in connection.execute("SELECT email,state FROM contact_point ORDER BY email")] == [(SYNTHETIC["avery_alias_email"], "catch_all"), (SYNTHETIC["avery_email"], "valid")]
    assert connection.execute("SELECT state FROM credit_reservation").fetchone()[0] == "settled"
    assert connection.execute("SELECT state FROM exec_request").fetchone()[0] == "succeeded"
    assert tuple(connection.execute("SELECT api_version,task_hash,result_url FROM provider_attempt_meta").fetchone()) == (
        "v2", "synthetic-email-task-1", "https://api.snov.io/v2/prospect/email-search/result/synthetic-email-task-1",
    )
    assert any("/v2/prospect/avery/search-emails/start" in call for call in calls)
    assert sum("/result/" in call for call in calls) == 2


def test_in_progress_is_uncertain_and_a_later_run_resumes_without_restart(tmp_path, monkeypatch):
    connection = _store(tmp_path)
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    monkeypatch.setattr(vendors.time, "sleep", lambda _seconds: None)
    calls = []
    first_values = iter([{"success": True, "access_token": "token-private", "token_type": "Bearer", "expires_in": 3600}, _fixture("email-search-start.json")] + [_fixture("email-search-in-progress.json")] * 8)
    def first(request, timeout):
        calls.append(request.full_url)
        return _Response(next(first_values))
    monkeypatch.setattr(vendors.urllib.request, "urlopen", first)
    first_executor = Executor(connection)
    adapter = attach_vendors(first_executor, now=AT, providers=("snov",))["snov"]
    _queue(first_executor, adapter)
    assert first_executor.process_one()
    assert connection.execute("SELECT state FROM exec_request").fetchone()[0] == "uncertain"
    assert connection.execute("SELECT state FROM credit_reservation").fetchone()[0] == "reserved"
    assert connection.execute("SELECT task_hash FROM snov_email_search").fetchone()[0] == "synthetic-email-task-1"
    second_values = iter([{"success": True, "access_token": "token-private", "token_type": "Bearer", "expires_in": 3600}, _fixture("email-search-complete.json")])
    def second(request, timeout):
        calls.append(request.full_url)
        return _Response(next(second_values))
    monkeypatch.setattr(vendors.urllib.request, "urlopen", second)
    second_executor = Executor(connection)
    attach_vendors(second_executor, now=AT, providers=("snov",))
    assert second_executor.process_one()
    assert connection.execute("SELECT state FROM exec_request").fetchone()[0] == "succeeded"
    assert connection.execute("SELECT state FROM credit_reservation").fetchone()[0] == "settled"
    assert connection.execute("SELECT count(*) FROM credit_reservation").fetchone()[0] == 1
    assert sum("/search-emails/start" in call for call in calls) == 1
    assert connection.execute("SELECT count(*) FROM contact_point").fetchone()[0] == 2


def test_poll_http_error_is_uncertain_and_a_later_run_resumes_without_restart(tmp_path, monkeypatch):
    import io
    import urllib.error

    connection = _store(tmp_path)
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    calls = []
    first_values = iter([
        {"success": True, "access_token": "token-private", "token_type": "Bearer", "expires_in": 3600},
        _fixture("email-search-start.json"),
    ])

    def first(request, timeout):
        calls.append(request.full_url)
        if "/result/" in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 502, "bad gateway", {}, io.BytesIO())
        return _Response(next(first_values))

    monkeypatch.setattr(vendors.urllib.request, "urlopen", first)
    first_executor = Executor(connection)
    adapter = attach_vendors(first_executor, now=AT, providers=("snov",))["snov"]
    _queue(first_executor, adapter)
    assert first_executor.process_one()
    assert connection.execute("SELECT state FROM exec_request").fetchone()[0] == "uncertain"
    assert connection.execute("SELECT state FROM credit_reservation").fetchone()[0] == "reserved"
    assert tuple(connection.execute("SELECT task_hash,result_url FROM snov_email_search").fetchone()) == (
        "synthetic-email-task-1", "https://api.snov.io/v2/prospect/email-search/result/synthetic-email-task-1",
    )

    second_values = iter([{"success": True, "access_token": "token-private", "token_type": "Bearer", "expires_in": 3600}, _fixture("email-search-complete.json")])

    def second(request, timeout):
        calls.append(request.full_url)
        return _Response(next(second_values))

    monkeypatch.setattr(vendors.urllib.request, "urlopen", second)
    second_executor = Executor(connection)
    attach_vendors(second_executor, now=AT, providers=("snov",))
    assert second_executor.process_one()
    assert connection.execute("SELECT state FROM exec_request").fetchone()[0] == "succeeded"
    assert connection.execute("SELECT state FROM credit_reservation").fetchone()[0] == "settled"
    assert sum("/search-emails/start" in call for call in calls) == 1
    assert connection.execute("SELECT count(*) FROM contact_point").fetchone()[0] == 2


def test_credentials_do_not_escape_typed_http_error(monkeypatch):
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    import io
    import urllib.error
    def urlopen(request, timeout):
        raise urllib.error.HTTPError(SYNTHETIC["private_error_url"], 401, "no", {}, io.BytesIO())
    monkeypatch.setattr(vendors.urllib.request, "urlopen", urlopen)
    try:
        vendors._snov_email_transport("https://api.snov.io/v2/prospect/avery/search-emails/start", None, None)
    except vendors.VendorHttpError as error:
        text = repr(error) + repr(error.__cause__) + repr(error.__context__)
        assert error.provider == "snov" and error.status == 401
        assert "client-private" not in text and "secret-private" not in text and "vendor.test" not in text
    else:
        raise AssertionError("expected typed error")


def test_snov_account_ceiling_rejects_a_second_campaign_at_queue_time(tmp_path):
    connection = _store(tmp_path)
    (tmp_path / "operator-vendors.json").write_text('{"snov_account_credit_ceiling":1}', encoding="utf-8")
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("camp_0000000000000002", "networking", "sender", "{}", "relationship", 15, "warm", "fixture", "[]", "00:00-23:59", "UTC", 25, 6, 2, "T0", "sender", "{}", 10, "active", HASH),
    )
    connection.commit()
    executor = Executor(connection)
    adapter = attach_vendors(executor, now=AT, providers=("snov",))["snov"]
    _queue(executor, adapter)
    adapter.queue(
        connection, campaign_id="camp_0000000000000002", person_id="per_0000000000000001",
        policy_hash=HASH, request_id="req_0000000000000002", now=AT,
    )
    assert tuple(connection.execute("SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000002'").fetchone()) == ("rejected", "skipped_budget")
    assert connection.execute("SELECT count(*) FROM credit_reservation WHERE exec_request_id='req_0000000000000002'").fetchone()[0] == 0
