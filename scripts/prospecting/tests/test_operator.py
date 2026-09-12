"""Synthetic coverage for the desktop-only P6 operator commands."""

from __future__ import annotations

import json
import gc
from pathlib import Path
import sqlite3
import socket
import ssl
import subprocess
import sys
import types
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

import pytest

from scripts.prospecting.operator import cli
from scripts.prospecting.operator import vendors
from scripts.prospecting import bakeoff
from scripts.prospecting.executor import Executor
from scripts.prospecting.fetcher import FetchResponse
from scripts.prospecting.list_builder import _queue_person_vendor_lookups
from scripts.prospecting.store import Company, ContactPoint, Person, insert_company, insert_contact_point, insert_person, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_operator")


def _ask() -> str:
    return " ".join((
        "intent:" + "networking", "lane:" + "manual", "companies-count:" + str(1),
        "people-count:" + str(2), "ask:" + "relationship", "credits:" + str(10),
    ))


def _open(path: Path):
    return open_store(path)


def _capture(path: Path) -> None:
    path.write_text(
        "kind,linkedin_url,name,first_name\n"
        "person,https://professional-network.invalid/profile/synthetic,Fixture,Fixture\n",
        encoding="utf-8",
    )


class _Response:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *unused: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def _snapshot_adapter(tmp_path: Path, website_url: str) -> tuple[sqlite3.Connection, object, str]:
    connection = _open(tmp_path / "store.sqlite")
    company_id = "cmp_0000000000000001"
    insert_company(connection, Company(
        company_id, "Synthetic", website_url, None, None, None, None, "manual", "snapshot-company",
    ))
    connection.commit()
    executor = Executor(connection)
    vendors._register_snapshot_adapter(executor)
    return connection, executor._adapters["fetch_snapshot"], company_id


def test_snapshot_adapter_allows_only_bare_and_www_hosts_and_profiles_description(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, adapter, company_id = _snapshot_adapter(tmp_path, "https://synthetic.test")
    seen_policies: list[tuple[str, ...]] = []

    def blocked_redirect(url: str, policy: object) -> FetchResponse:
        del url
        seen_policies.append(policy.allowed_hosts)  # type: ignore[union-attr]
        return FetchResponse(b"", "text/html", "https://other.synthetic.test")

    monkeypatch.setattr(vendors, "_http", blocked_redirect)
    try:
        assert adapter(SimpleNamespace(payload={"entity_id": company_id})) == ("rejected", "fetch_domain_blocked")

        description = "Synthetic homepage " + "x" * 180
        monkeypatch.setattr(
            vendors,
            "_http",
            lambda url, policy: FetchResponse(
                f'<meta name="description" content="{description}">'.encode(), "text/html", "https://www.synthetic.test/",
            ),
        )
        assert adapter(SimpleNamespace(payload={"entity_id": company_id})) == ("succeeded", "snapshot_profiled")
        profile = connection.execute("SELECT blurb FROM company_profile WHERE company_id=?", (company_id,)).fetchone()
        assert profile is not None and profile["blurb"] == description[:160]
    finally:
        connection.close()
    assert seen_policies == [("synthetic.test", "www.synthetic.test")]


@pytest.mark.parametrize(
    ("failure", "reason"),
    (
        (ssl.SSLError("synthetic certificate failure"), "fetch_transport_error"),
        (socket.timeout("synthetic timeout"), "fetch_transport_error"),
        (URLError("synthetic transport failure"), "fetch_transport_error"),
        (OSError("synthetic transport failure"), "fetch_transport_error"),
        (HTTPError("https://synthetic.test", 500, "synthetic", {}, None), "fetch_http_error"),
    ),
)
def test_snapshot_adapter_types_fetch_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception, reason: str,
) -> None:
    connection, adapter, company_id = _snapshot_adapter(tmp_path, "https://www.synthetic.test")
    seen_policies: list[tuple[str, ...]] = []

    def failed_transport(url: str, policy: object) -> FetchResponse:
        del url
        seen_policies.append(policy.allowed_hosts)  # type: ignore[union-attr]
        raise failure

    monkeypatch.setattr(vendors, "_http", failed_transport)
    try:
        assert adapter(SimpleNamespace(payload={"entity_id": company_id})) == ("rejected", reason)
    finally:
        connection.close()
    assert seen_policies == [("www.synthetic.test", "synthetic.test")]


def test_operator_in_process_commands_are_counts_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], record_property: object) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    created = cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))
    campaign_id = str(created["campaign_id"])
    source = tmp_path / "captures.csv"
    _capture(source)
    captured = cli.capture_add(campaign_id, source, open_store_fn=lambda: _open(store))
    assert cli.main(["vendors", "attach", "--providers", "hunter,snov"]) == 0
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual", "--max-people", "1"]) == 0
    connection = _open(store)
    try:
        with connection:
            connection.execute("UPDATE exec_request SET state='rejected' WHERE state='queued'")
    finally:
        connection.close()
    monkeypatch.setenv("HUNTER_API_KEY", "hunter-credential-test")
    monkeypatch.setenv("SNOV_CLIENT_ID", "snov-client-test")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "snov-secret-test")
    def valid_response(request: object, **unused: object) -> _Response:
        if "hunter" in str(getattr(request, "full_url", "")):
            return _Response(b'{"data":{"status":"valid","email":"opaque-email-ref"}}')
        return _Response(b'{"data":[{"status":"valid","email":"opaque-email-ref"}]}')

    monkeypatch.setattr(vendors.urllib.request, "urlopen", valid_response)
    metrics = cli.bakeoff_run(campaign_id, 2, open_store_fn=lambda: _open(store))
    report = cli.bakeoff_report(campaign_id, open_store_fn=lambda: _open(store))
    other_campaign = str(cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))["campaign_id"])
    assert cli.main(["campaign", "lanes", "--campaign", other_campaign, "--lanes", "manual,snov_domain"]) == 0
    connection = _open(store)
    try:
        row = connection.execute("SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (other_campaign,)).fetchone()
        assert json.loads(row["policy_json"])["lane_plan"] == ["manual", "snov_domain"]
        assert row["policy_hash"] == cli.compile_target_policy(json.loads(row["policy_json"]), lambda _value: None).policy_hash
        with connection:
            connection.execute("UPDATE campaign SET status='paused' WHERE campaign_id=?", (other_campaign,))
    finally:
        connection.close()
    assert cli.main(["campaign", "lanes", "--campaign", other_campaign, "--lanes", "manual"]) == 2
    assert cli.main(["vendors", "attach"]) == 0
    assert cli.main(["executor", "run", "--once"]) == 0
    output = json.dumps({"created": created, "captured": captured, "report": report}) + capsys.readouterr().out
    assert created["campaigns"] == 1
    assert captured["inserted"] == 1
    assert {metric.provider for metric in metrics} == {"A", "B"}
    assert report == {"hunter_attempts": 1, "hunter_valid": 1, "snov_attempts": 1, "snov_valid": 1}
    assert cli.bakeoff_report(other_campaign, open_store_fn=lambda: _open(store)) == {"hunter_attempts": 0, "snov_attempts": 0}
    assert "Fixture" not in output
    assert "professional-network.invalid" not in output
    record_property("operator_commands", 9)  # type: ignore[attr-defined]


def test_bakeoff_run_emits_only_blind_labels_and_counts(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    metrics = (
        bakeoff.BakeoffMetric("hunter", 3, 0, 0, 3, {}, 3, None, (0.0, 0.0), (0.0, 0.0)),
        bakeoff.BakeoffMetric("snov", 2, 0, 0, 2, {}, 2, None, (0.0, 0.0), (0.0, 0.0)),
    )
    monkeypatch.setattr(cli, "bakeoff_run", lambda *unused, **also_unused: metrics)

    assert cli.main(["bakeoff", "run", "--campaign", "camp_0000000000000001", "--contacts", "2"]) == 0

    assert json.loads(capsys.readouterr().out) == {"A_attempts": 3, "B_attempts": 2}


def test_bakeoff_passes_only_aliases_to_the_frozen_scorer_and_unmasks_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    campaign_id = str(cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))["campaign_id"])
    assert cli.main(["vendors", "attach", "--providers", "hunter,snov"]) == 0
    seen: list[str] = []

    def scorer(cases: object, participants: object, *unused: object, **also_unused: object) -> tuple[bakeoff.BakeoffMetric, ...]:
        del cases
        seen.extend(participant.provider for participant in participants)  # type: ignore[union-attr]
        assert all(set(participant.__dict__) == {"provider", "_token"} for participant in participants)  # type: ignore[union-attr]
        return tuple(
            bakeoff.BakeoffMetric(participant.provider, 0, 0, 0, 0, {}, 0, None, (0.0, 0.0), (0.0, 0.0))
            for participant in participants  # type: ignore[union-attr]
        )

    monkeypatch.setattr(bakeoff, "run_bakeoff", scorer)
    assert [metric.provider for metric in cli.bakeoff_run(campaign_id, 1, open_store_fn=lambda: _open(store))] == ["A", "B"]
    assert seen == ["A", "B"]
    assert cli.bakeoff_report(campaign_id, open_store_fn=lambda: _open(store)) == {
        "hunter_attempts": 0, "snov_attempts": 0,
    }


def test_operator_subprocess_campaign_capture_and_list(tmp_path: Path, record_property: object) -> None:
    store = tmp_path / "store.sqlite"
    source = tmp_path / "captures.csv"
    _capture(source)
    ask_file = tmp_path / "ask.txt"
    ask_file.write_text(_ask(), encoding="utf-8")
    domains = tmp_path / "kb-prospecting"
    domains.mkdir()
    (domains / "company-domains.csv").write_text("name,domain\n", encoding="utf-8")
    environment = {"KB_PROSPECTING_STORE": str(store), "LOCALAPPDATA": str(tmp_path)}
    environment["KB_PROSPECTING_NO_NETWORK"] = "1"  # gate guard: every child carries the marker
    created = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "campaign", "new", "--ask-file", str(ask_file), "--lanes", "manual,snov_domain"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    value = json.loads(created.stdout)
    campaign_id = value["campaign_id"]
    captured = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "capture", "add", "--campaign", campaign_id, "--file", str(source)],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    attached = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "vendors", "attach", "--providers", "hunter,snov"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    listed = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "list", "--campaign", campaign_id, "--lanes", "manual,snov_domain", "--max-people", "1"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    mismatched = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "list", "--campaign", campaign_id, "--lanes", "manual", "--max-people", "1"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=False,
    )
    combined = created.stdout + captured.stdout + attached.stdout + listed.stdout + created.stderr + captured.stderr + attached.stderr + listed.stderr
    assert "Fixture" not in combined
    assert "professional-network.invalid" not in combined
    assert json.loads(captured.stdout)["inserted"] == 1
    assert mismatched.returncode != 0
    assert "requested_lanes_must_match_campaign_policy" in mismatched.stderr
    record_property("operator_commands", 3)  # type: ignore[attr-defined]


def test_operator_snov_domain_discovery_queues_email_searches_then_persists_contacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    ask_file = tmp_path / "ask.txt"
    ask_file.write_text(
        "intent:networking lane:manual companies-count:1 people-count:2 "
        "title:associate ask:relationship credits:10",
        encoding="utf-8",
    )
    source = tmp_path / "captures.csv"
    source.write_text(
        "kind,linkedin_url,name,first_name\n"
        "company,https://professional-network.invalid/organization/alpha-synthetic,Alpha Synthetic,\n",
        encoding="utf-8",
    )
    domains = tmp_path / "kb-prospecting"
    domains.mkdir()
    (domains / "company-domains.csv").write_text(
        "name,domain\nAlpha Synthetic,alpha.test\n", encoding="utf-8",
    )

    assert cli.main(["campaign", "new", "--ask-file", str(ask_file), "--lanes", "manual,snov_domain"]) == 0
    campaign_id = json.loads(capsys.readouterr().out)["campaign_id"]
    assert cli.main(["capture", "add", "--campaign", campaign_id, "--file", str(source)]) == 0
    assert cli.main(["vendors", "attach", "--providers", "snov"]) == 0

    fixtures = Path("orgs/prospecting/fixtures/vendor/snov")
    page = json.loads((fixtures / "v2-prospects-page-1.json").read_text(encoding="utf-8"))
    email_start = json.loads((fixtures / "email-search-start.json").read_text(encoding="utf-8"))
    email_complete = json.loads((fixtures / "email-search-complete.json").read_text(encoding="utf-8"))

    def email_search_response(request: object, **unused: object) -> _Response:
        url = str(getattr(request, "full_url", ""))
        if url.endswith("/v1/oauth/access_token"):
            return _Response(b'{"access_token":"synthetic-token"}')
        if url.endswith("/search-emails/start"):
            prospect = urlparse(url).path.split("/")[-3]
            started = {**email_start, "meta": {"task_hash": f"synthetic-email-{prospect}"}, "links": {
                "result": f"https://api.snov.io/v2/prospect/email-search/result/{prospect}",
            }}
            return _Response(json.dumps(started).encode("utf-8"))
        prospect = urlparse(url).path.split("/")[-1]
        completed = {**email_complete, "data": [
            {"email": f"{prospect}@alpha.test", "status": "valid"},
            {
                "email": SYNTHETIC["alias_email_template"].format(prospect=prospect),
                "status": "catch_all",
            },
        ]}
        return _Response(json.dumps(completed).encode("utf-8"))

    monkeypatch.setenv("SNOV_CLIENT_ID", "snov-client-test")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "snov-secret-test")
    monkeypatch.setattr(vendors.urllib.request, "urlopen", email_search_response)
    monkeypatch.setattr(vendors, "_snov_domain_transport", lambda **unused: {**page, "links": {}})
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual,snov_domain"]) == 0
    assert cli.main(["executor", "run", "--once"]) == 0
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual,snov_domain"]) == 0

    connection = _open(store)
    try:
        assert connection.execute("SELECT COUNT(*) FROM contact_point").fetchone()[0] == 0
        discovered = connection.execute("SELECT COUNT(*) FROM snov_prospect").fetchone()[0]
        assert connection.execute("SELECT COUNT(*) FROM person").fetchone()[0] == discovered
        lookup = connection.execute(
            """SELECT er.state,json_extract(er.payload,'$.provider') AS provider,cr.max_cost,
                      EXISTS(SELECT 1 FROM contact_point AS cp WHERE cp.person_id=json_extract(er.payload,'$.person_id')) AS has_contact
               FROM exec_request AS er JOIN credit_reservation AS cr ON cr.exec_request_id=er.request_id
               WHERE er.operation='vendor_lookup'
               ORDER BY er.request_id"""
        ).fetchall()
    finally:
        connection.close()
    assert len(lookup) == discovered
    assert all(tuple(row) == ("queued", "snov", 1, 0) for row in lookup)

    assert cli.main(["executor", "run"]) == 0
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual,snov_domain"]) == 0

    connection = _open(store)
    try:
        assert connection.execute("SELECT COUNT(*) FROM person").fetchone()[0] == discovered
        assert connection.execute("SELECT COUNT(*) FROM contact_point").fetchone()[0] == 2 * discovered
        assert [tuple(row) for row in connection.execute(
            "SELECT provider,state,COUNT(*) FROM contact_point GROUP BY provider,state ORDER BY state"
        )] == [("snov", "catch_all", discovered), ("snov", "valid", discovered)]
        assert connection.execute("SELECT COUNT(*) FROM source_observation WHERE entity_type='contact'").fetchone()[0] == 2 * discovered
        lookup = connection.execute(
            """SELECT er.state,json_extract(er.payload,'$.provider') AS provider,cr.max_cost,
                      EXISTS(SELECT 1 FROM contact_point AS cp WHERE cp.person_id=json_extract(er.payload,'$.person_id')) AS has_contact
               FROM exec_request AS er JOIN credit_reservation AS cr ON cr.exec_request_id=er.request_id
               WHERE er.operation='vendor_lookup'
               ORDER BY er.request_id"""
        ).fetchall()
    finally:
        connection.close()
    assert len(lookup) == discovered
    assert all(tuple(row) == ("succeeded", "snov", 1, 1) for row in lookup)


def test_vendor_attachment_is_durable_across_subprocesses(tmp_path: Path) -> None:
    store = tmp_path / "store.sqlite"
    ask_file = tmp_path / "ask.txt"
    ask_file.write_text(_ask(), encoding="utf-8")
    environment = {"KB_PROSPECTING_STORE": str(store), "KB_PROSPECTING_NO_NETWORK": "1"}
    created = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "campaign", "new", "--ask-file", str(ask_file)],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    campaign_id = json.loads(created.stdout)["campaign_id"]
    attached = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "vendors", "attach", "--providers", "hunter,snov"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    baked = subprocess.run(
        [sys.executable, "-m", "scripts.prospecting.operator", "bakeoff", "run", "--campaign", campaign_id, "--contacts", "1"],
        cwd=Path.cwd(), env=environment, text=True, capture_output=True, check=True,
    )
    assert json.loads(attached.stdout) == {"adapters": 1, "providers": 2}
    assert json.loads(baked.stdout) == {"A_attempts": 0, "B_attempts": 0}
    assert json.loads((tmp_path / "operator-vendors.json").read_text(encoding="utf-8")) == {
        "bakeoff_aliases": {"A": "hunter", "B": "snov"}, "providers": ["hunter", "snov"],
    }


def test_snov_lookup_uses_attached_adapter_and_skips_existing_contact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    campaign_id = str(cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))["campaign_id"])
    connection = _open(store)
    try:
        policy_hash = str(connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0])
        first, second = "per_0000000000000001", "per_0000000000000002"
        insert_person(connection, Person(first, "Synthetic", "Synthetic Person", None, None, None, "manual", "lookup-first"))
        insert_person(connection, Person(second, "Synthetic", "Synthetic Contact", None, None, None, "manual", "lookup-second"))
        insert_contact_point(connection, ContactPoint("cp_0000000000000002", second, None, SYNTHETIC["existing_email"], "manual", "fixture", None, None, "risky", 1.0, 0))
        _queue_person_vendor_lookups(
            connection, campaign_id, (first, second), policy_hash, "2026-09-04T00:00:00Z",
            "snov", "find", 1,
        )
        queued = connection.execute("SELECT request_id,json_extract(payload,'$.person_id') AS person_id FROM exec_request").fetchall()
        assert len(queued) == 1 and queued[0]["person_id"] == first
    finally:
        connection.close()
    assert cli.main(["vendors", "attach", "--providers", "snov", "--per-firm", "2"]) == 0
    assert cli.executor_run(once=False)["rejected"] == 0
    connection = _open(store)
    try:
        assert tuple(connection.execute("SELECT state,reason FROM exec_request").fetchone()) == ("succeeded", "vendor_completed")
    finally:
        connection.close()
    assert json.loads((tmp_path / "operator-vendors.json").read_text(encoding="utf-8"))["per_firm"] == 2


def test_vendor_attachment_preserves_unowned_config_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    (tmp_path / "operator-vendors.json").write_text(
        '{"snov_account_credit_ceiling":1000,"custom":"x"}', encoding="utf-8",
    )

    assert cli.main(["vendors", "attach", "--providers", "snov", "--per-firm", "6"]) == 0

    assert json.loads((tmp_path / "operator-vendors.json").read_text(encoding="utf-8")) == {
        "bakeoff_aliases": {}, "custom": "x", "per_firm": 6,
        "providers": ["snov"], "snov_account_credit_ceiling": 1000,
    }


def test_vendor_attachment_writes_title_exclusions_and_allows_an_empty_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))

    assert cli.main(["vendors", "attach", "--providers", "snov", "--title-exclusions", "finance,operations"]) == 0
    assert json.loads((tmp_path / "operator-vendors.json").read_text(encoding="utf-8"))["title_function_exclusions"] == ["finance", "operations"]
    assert cli.main(["vendors", "attach", "--providers", "snov", "--title-exclusions", ""]) == 0
    assert json.loads((tmp_path / "operator-vendors.json").read_text(encoding="utf-8"))["title_function_exclusions"] == []


def test_bakeoff_refuses_without_durable_vendor_attachment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    campaign_id = str(cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))["campaign_id"])

    assert cli.main(["bakeoff", "run", "--campaign", campaign_id, "--contacts", "1"]) == 2

    assert json.loads(capsys.readouterr().out) == {
        "command": "vendors attach --providers hunter,snov", "error": "vendors_not_attached",
    }
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual"]) == 2
    assert json.loads(capsys.readouterr().out) == {
        "command": "vendors attach --providers hunter,snov", "error": "vendors_not_attached",
    }


def test_live_transport_requires_a_claimed_reservation(monkeypatch: pytest.MonkeyPatch, record_property: object) -> None:
    monkeypatch.delenv("HUNTER_API_KEY", raising=False)
    assert not hasattr(vendors, "_call")
    with pytest.raises(ValueError) as raised:
        vendors._live_call("hunter", "find", {}, "request-id", 1)
    assert str(raised.value) == "unclaimed_transport"
    adapter = vendors.DesktopVendorAdapter("hunter", sqlite3.connect(":memory:"))
    with pytest.raises(ValueError, match="unclaimed_transport"):
        adapter._execute(SimpleNamespace(provider="hunter"), "find", {}, "request-id", claim_token=object())
    record_property("operator_commands", 1)  # type: ignore[attr-defined]


def test_operator_rejects_pii_shaped_argument_without_echo(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["--" + SYNTHETIC["person_email"], SYNTHETIC["person_email"]]) == 2
    captured = capsys.readouterr()
    assert SYNTHETIC["person_email"] not in captured.err
    assert "@" not in captured.err
    assert "operator: invalid arguments (unknown-argument)" in captured.err
    assert cli.main(["campaign", "new", "--ask-file-extra", SYNTHETIC["person_email"]]) == 2
    assert "operator: invalid arguments (--ask-file)" in capsys.readouterr().err
    assert cli.main(["list", "--" + SYNTHETIC["person_email"], SYNTHETIC["person_email"]]) == 2
    assert "@" not in capsys.readouterr().err
    assert cli.main(["campaign", "new", "--name", "local-label"]) == 2
    rejected = capsys.readouterr().err
    assert "local-label" not in rejected
    assert "operator: invalid arguments (unknown-argument)" in rejected


def test_fill_refusal_reason_is_fixed_and_pii_guarded(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    def refuse_known(*unused: object, **unused_keywords: object) -> object:
        raise ValueError("invalid_fill_limits")

    monkeypatch.setattr(cli, "fill_run", refuse_known)
    assert cli.main(["fill", "--campaign", "camp_0000000000000001", "--target-per-firm", "1"]) == 2
    assert json.loads(capsys.readouterr().out) == {
        "error": "operator_refused", "reason": "invalid_fill_limits",
    }

    def refuse_unexpected(*unused: object, **unused_keywords: object) -> object:
        raise ValueError(SYNTHETIC["person_email"])

    monkeypatch.setattr(cli, "fill_run", refuse_unexpected)
    assert cli.main(["fill", "--campaign", "camp_0000000000000001", "--target-per-firm", "1"]) == 2
    output = capsys.readouterr().out
    assert SYNTHETIC["person_email"] not in output
    assert json.loads(output) == {"error": "operator_refused", "reason": "unexpected"}


@pytest.mark.parametrize(
    ("argv", "parser_argv"),
    (
        (["capture", "add", "--campaign", SYNTHETIC["email_shaped_campaign"], "--file", "capture.csv"], None),
        (["bakeoff", "run", "--campaign", SYNTHETIC["email_shaped_campaign"], "--contacts", "1"], None),
        (["bakeoff", "report", "--campaign", SYNTHETIC["email_shaped_campaign"]], None),
        (["list", "--campaign", SYNTHETIC["email_shaped_campaign"], "--lanes", "manual"], ["--campaign", "camp_0123456789abcdef", "--lanes", "manual"]),
    ),
)
def test_operator_rejects_nonopaque_campaign_ids_without_echo(
    argv: list[str], parser_argv: list[str] | None, capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(argv) == 2
    rejected = capsys.readouterr().err
    assert SYNTHETIC["email_shaped_campaign"] not in rejected
    assert "@" not in rejected
    assert rejected == "operator: invalid arguments (--campaign)\n"

    valid_argv = parser_argv or [
        *argv[: argv.index("--campaign") + 1], "camp_0123456789abcdef", *argv[argv.index("--campaign") + 2:],
    ]
    parser = cli._list_parser() if argv[0] == "list" else cli._parser()
    parsed = parser.parse_args(valid_argv)
    assert parsed.campaign == "camp_0123456789abcdef"


def test_help_prints_parser_help_and_propagates_successful_exit(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as raised:
        cli.main(["campaign", "--help"])
    assert raised.value.code == 0
    assert "usage:" in capsys.readouterr().out


def _reachable_strings(roots: tuple[object, ...]) -> set[str]:
    """Follow closure-owned executor state without traversing module globals."""
    pending = list(roots)
    visited: set[int] = set()
    values: set[str] = set()
    while pending:
        current = pending.pop()
        identifier = id(current)
        if identifier in visited:
            continue
        visited.add(identifier)
        if isinstance(current, str):
            values.add(current)
            continue
        if isinstance(current, types.FunctionType):
            pending.extend(cell.cell_contents for cell in current.__closure__ or ())
            continue
        if isinstance(current, types.MethodType):
            pending.append(current.__self__)
            continue
        pending.extend(gc.get_referents(current))
    return values


def _assert_emit_refuses_pii() -> None:
    refused = False
    try:
        cli._emit({"processed": SYNTHETIC["person_email"]})
    except ValueError:
        refused = True
    assert refused


def test_emit_refuses_pii_in_count_values(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_emit_refuses_pii()
    monkeypatch.setattr(cli, "assert_vm_safe", lambda *unused: None)
    with pytest.raises(AssertionError):
        _assert_emit_refuses_pii()


def test_live_lookups_do_not_persist_environment_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store))
    keys = {
        "HUNTER_API_KEY": "hunter-credential-test",
        "SNOV_CLIENT_ID": "snov-client-test",
        "SNOV_CLIENT_SECRET": "snov-secret-test",
        "PDL_API_KEY": "pdl-credential-test",
        "APIFY_TOKEN": "apify-credential-test",
    }
    for name, value in keys.items():
        monkeypatch.setenv(name, value)
    captured_requests: list[tuple[str, str, str]] = []

    email_start = json.loads((Path("orgs/prospecting/fixtures/vendor/snov") / "email-search-start.json").read_text(encoding="utf-8"))
    email_complete = json.loads((Path("orgs/prospecting/fixtures/vendor/snov") / "email-search-complete.json").read_text(encoding="utf-8"))

    def recorder(request: object, timeout: int) -> _Response:
        method = str(getattr(request, "method", ""))
        host = urlparse(str(getattr(request, "full_url", ""))).hostname
        provider = {
            "api.hunter.io": "hunter",
            "api.snov.io": "snov",
            "api.peopledatalabs.com": "pdl",
            "api.apify.com": "apify",
        }[host]
        captured_requests.append((provider, method, str(timeout)))
        projection = "\n".join((
            str(getattr(request, "full_url", "")),
            bytes(getattr(request, "data", b"") or b"").decode("utf-8"),
            repr(getattr(request, "headers", {})),
        ))
        assert any(value in projection for value in keys.values())
        if provider == "hunter" and len(captured_requests) == 1:
            raise HTTPError(str(getattr(request, "full_url", "")), 500, "error", {}, None)
        url = str(getattr(request, "full_url", ""))
        if url.endswith("/v1/oauth/access_token"):
            return _Response(b'{"access_token":"snov-client-test"}')
        if url.endswith("/search-emails/start"):
            return _Response(json.dumps(email_start).encode("utf-8"))
        if "/email-search/result/" in url:
            return _Response(json.dumps(email_complete).encode("utf-8"))
        return _Response(b'{"data":[]}')

    monkeypatch.setattr(vendors.urllib.request, "urlopen", recorder)
    created = cli.campaign_new(_ask(), open_store_fn=lambda: _open(store))
    campaign_id = str(created["campaign_id"])
    source = tmp_path / "captures.csv"
    _capture(source)
    cli.capture_add(campaign_id, source, open_store_fn=lambda: _open(store))
    assert cli.main(["vendors", "attach", "--providers", "hunter,snov"]) == 0
    assert cli.main(["list", "--campaign", campaign_id, "--lanes", "manual", "--max-people", "1"]) == 0
    connection = _open(store)
    try:
        with connection:
            connection.execute("UPDATE exec_request SET state='rejected' WHERE state='queued'")
        person_id = str(connection.execute(
            "SELECT person_id FROM eligibility_decision WHERE campaign_id=? AND outcome='eligible'", (campaign_id,)
        ).fetchone()[0])
        company_id = "cmp_0000000000000001"
        insert_company(connection, Company(
            company_id, "Synthetic", None, None, None, None, None, "manual", "synthetic-company",
        ))
        connection.execute(
            "INSERT INTO snov_prospect VALUES(?,?,?,?)",
            (person_id, company_id, "https://profiles.test/synthetic", "https://api.snov.io/v2/prospect/synthetic/search-emails/start"),
        )
        connection.commit()
        executor = Executor(connection)
        adapters = vendors.attach_vendors(executor, now="2026-09-03T00:00:00Z", providers=("hunter", "snov", "pdl", "apify"))
        policy_hash = str(connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0])
        find_adapters = {
            provider: adapter
            for provider, adapter in adapters.items()
            if vendors._OPERATIONS[adapter.provider] == "find"
        }
        for index, (provider, adapter) in enumerate(find_adapters.items()):
            adapter.queue(connection, campaign_id=campaign_id, person_id=person_id, policy_hash=policy_hash, request_id=f"req_{index:016x}", now="2026-09-03T00:00:00Z")
        claimed = executor._claim()
        assert claimed is not None
        reservation_id = str(connection.execute("SELECT reservation_id FROM credit_reservation WHERE exec_request_id=?", (claimed["request_id"],)).fetchone()[0])
        with pytest.raises(vendors.VendorHttpError) as raised:
            vendors._live_call("hunter", "find", {}, str(claimed["request_id"]), 20, connection=connection, reservation=SimpleNamespace(reservation_id=reservation_id))
        assert raised.value.provider == "hunter"
        assert raised.value.status == 500
        assert raised.value.__cause__ is None
        assert raised.value.__context__ is None
        for value in keys.values():
            assert value not in str(raised.value)
        while executor.process_one():
            pass
        captured = capsys.readouterr()
        persistent = "\n".join(connection.iterdump()) + repr(adapters) + captured.out + captured.err
        reachable = _reachable_strings(tuple(executor._adapters.values()))
        people_without_email = int(connection.execute(
            """SELECT COUNT(*) FROM person AS p WHERE NOT EXISTS (
                   SELECT 1 FROM contact_point AS cp WHERE cp.person_id=p.person_id
               )"""
        ).fetchone()[0])
        queued_lookup_providers = {
            str(row[0]) for row in connection.execute(
                "SELECT DISTINCT json_extract(payload,'$.provider') FROM exec_request WHERE operation='vendor_lookup'"
            )
        }
    finally:
        connection.close()
    assert {provider for provider, _, _ in captured_requests} == queued_lookup_providers
    for value in keys.values():
        assert value not in persistent
        assert all(value not in item for item in gc.get_objects() if isinstance(item, str))
        assert value not in reachable
