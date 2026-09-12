from __future__ import annotations

import io
import json
from pathlib import Path
import urllib.error

import pytest

from scripts.prospecting.discovery.snov_domain import (
    SnovDomainAdapter, SnovDomainLane, _contact_state, _title_matches, queue_finder_page,
)
from scripts.prospecting.executor import Executor
from scripts.prospecting.finder_manual import ManualLane
from scripts.prospecting.lanes import PREDICATE_TYPES, plan_lanes
from scripts.prospecting.manager.compile_ask import PREDICATES, compile_ask
from scripts.prospecting.operator import vendors
from scripts.prospecting.operator.vendors import VendorHttpError
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


AT = "2026-09-04T00:00:00Z"
HASH = "a" * 64
FIXTURES = Path("orgs/prospecting/fixtures/vendor/snov")
SYNTHETIC = legacy_fixture("test_snov_domain_lane")


def _fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _store(tmp_path: Path, monkeypatch, *, credit_budget: int = 10, policy=None):
    desktop = tmp_path / "desktop"
    desktop.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(desktop))
    connection = open_store(desktop / "store.sqlite")
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)", ("sender", "Synthetic", None, "Synthetic", "Synthetic", "Synthetic", "[]"))
    policy = policy or {"predicates": [{"predicate_id": "title", "type": "title", "value": ["associate", {"class": "director", "include_managing_director": True}]}]}
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("camp_0000000000000001", "networking", "sender", json.dumps(policy), "relationship", 15, "warm", "fixture", "[]", "00:00-23:59", "UTC", 25, 6, 2, "T0", "sender", "{}", credit_budget, "active", HASH))
    for index, name in enumerate(("Alpha Synthetic", "Beta Synthetic", "No Domain Synthetic"), 1):
        connection.execute("INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)", (f"cmp_{index:016x}", name, None, None, None, None, None, "manual", f"company-{index}"))
    connection.execute("INSERT INTO finder_run VALUES(?,?,?,?,?,?,?,?,?,?)", ("camp_0000000000000002", "camp_0000000000000001", HASH, 3, 3, "running", AT, AT, None, None))
    connection.commit()
    domains = desktop / "kb-prospecting" / "company-domains.csv"
    domains.parent.mkdir()
    domains.write_text("name,domain\nAlpha Synthetic,alpha.test\nBeta Synthetic,beta.test\n", encoding="utf-8")
    return connection, domains


def _drain(connection, transport, *, max_pages=30):
    adapter = SnovDomainAdapter(connection, transport, max_pages=max_pages)
    while row := connection.execute("SELECT * FROM exec_request WHERE state='queued' ORDER BY request_id LIMIT 1").fetchone():
        connection.execute("UPDATE exec_request SET state='claimed' WHERE request_id=?", (row["request_id"],))
        request = Executor._from_row(connection.execute("SELECT * FROM exec_request WHERE request_id=?", (row["request_id"],)).fetchone())
        adapter.execute(request, AT)
        connection.execute("UPDATE exec_request SET state='succeeded' WHERE request_id=?", (request.request_id,))
        connection.commit()


def test_complete_capability_map_allows_unselected_unsupported_predicates():
    first_ask = json.loads(Path("orgs/prospecting/fixtures/p5-asks.json").read_text(encoding="utf-8"))[0]
    tokens = dict(token.split(":", 1) for token in first_ask["ask"].split())
    first_policy = compile_target_policy(
        {
            "predicates": [
                {
                    "predicate_id": f"p{index:02d}-{predicate_type.replace('_', '-')}",
                    "type": predicate_type,
                    "value": tokens[key].split(","),
                }
                for index, (key, predicate_type) in enumerate(PREDICATES.items(), 1)
                if key in tokens
            ],
            "requested_companies": int(tokens.get("companies-count", "20")),
            "requested_people": int(tokens.get("people-count", "20")),
            "extra_fields": [],
            "lane_plan": [tokens.get("lane", "manual")],
            "scorer_version": "fit-v1",
        },
        lambda _name: "cmp_0000000000000001",
    )
    every_predicate_policy = compile_target_policy(
        {
            "predicates": [
                {
                    "predicate_id": f"p{index:02d}-{predicate.replace('_', '-')}",
                    "type": predicate,
                    "value": ["Synthetic Company"] if predicate == "company_list" else f"fixture-{index}",
                }
                for index, predicate in enumerate(PREDICATE_TYPES, 1)
            ],
            "requested_companies": 1,
            "requested_people": 1,
            "extra_fields": [],
            "lane_plan": ["manual"],
            "scorer_version": "fit-v1",
        },
        lambda _name: "cmp_0000000000000001",
    )

    for policy in (first_policy, every_predicate_policy):
        plans = plan_lanes(
            policy, (ManualLane(), SnovDomainLane()), frozenset(), "campaign-1", "policy-hash-1",
        )
        assert tuple(plan.lane for plan in plans) == ("manual",)

    outcomes = {name: capability.outcome for name, capability in SnovDomainLane().capabilities().items()}
    assert outcomes == {
        "industry": "exact",
        "company_type": "exact",
        "company_stage": "exact",
        "company_location": "exact",
        "person_location": "exact",
        "title": "exact",
        "seniority": "approximate",
        "school": "exact",
        "platform": "unsupported",
        "company_list": "exact",
    }


def test_curated_snov_capabilities_plan_real_ask_and_reject_platform_only():
    manual, snov_domain = ManualLane(), SnovDomainLane()
    manual_capabilities = {
        predicate: (capability.outcome, capability.version)
        for predicate, capability in manual.capabilities().items()
    }
    compiler_args = {
        "resolve_company": lambda _name: (),
        "campaign_id": "11111111-1111-4111-8111-111111111111",
        "sender_profile_id": "22222222-2222-4222-8222-222222222222",
        "mailbox_id": "mailbox-001",
        "capabilities": {"manual": manual_capabilities},
        "overrides": set(),
    }
    compiled = compile_ask(
        "intent:networking industry:venture_capital company-location:nyc title:associate,director people-count:60",
        **compiler_args,
    )
    policy = compile_target_policy(
        {**compiled.target_policy, "lane_plan": ["manual", "snov_domain"]},
        lambda _name: "cmp_0000000000000001",
    )

    plans = plan_lanes(
        policy, (manual, snov_domain), frozenset(),
        compiled.campaign_policy["campaign_id"], compiled.campaign_policy["policy_hash"],
    )

    assert tuple(plan.lane for plan in plans) == ("manual", "snov_domain")

    platform_compiled = compile_ask(
        "intent:networking platform:linkedin_assisted",
        **compiler_args,
    )
    platform_only_policy = compile_target_policy(
        {**platform_compiled.target_policy, "lane_plan": ["snov_domain"]},
        lambda _name: "cmp_0000000000000001",
    )
    with pytest.raises(ValueError, match="unsupported_predicate:p09-platform:snov_domain"):
        plan_lanes(
            platform_only_policy, (snov_domain,), frozenset(),
            platform_compiled.campaign_policy["campaign_id"],
            platform_compiled.campaign_policy["policy_hash"],
        )


def test_v2_page_shapes_persist_identity_and_queue_continuation_atomically(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)

    def transport(*, domain, page):
        if domain == "beta.test":
            return {"data": [], "meta": {"credits": 0}, "links": [], "status": "completed"}
        return _fixture(f"v2-prospects-page-{page}.json")

    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    assert lane.run(lane.plan(None), None).shortfall_reason == "no_domain"
    _drain(connection, transport)
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 2
    assert connection.execute("SELECT count(*) FROM contact_point").fetchone()[0] == 0
    prospects = {tuple(row) for row in connection.execute("SELECT source_page,search_emails_start FROM snov_prospect")}
    assert ("https://profiles.test/avery", "https://api.snov.io/v2/prospect/avery/search-emails/start") in prospects
    assert connection.execute("SELECT count(*) FROM snov_domain_page").fetchone()[0] == 3
    assert connection.execute("SELECT count(*) FROM credit_reservation WHERE state='settled'").fetchone()[0] == 3
    assert connection.execute("SELECT count(*) FROM provider_attempt WHERE provider='snov'").fetchone()[0] == connection.execute("SELECT count(*) FROM provider_attempt_meta").fetchone()[0]
    assert connection.execute("SELECT api_version FROM provider_attempt_meta ORDER BY attempt_id LIMIT 1").fetchone()[0] == "v2"
    assert connection.execute("SELECT website_url FROM company WHERE company_id='cmp_0000000000000001'").fetchone()[0] == "https://alpha.test"


def test_queue_page_persists_only_a_missing_valid_company_homepage(tmp_path, monkeypatch):
    connection, _domains = _store(tmp_path, monkeypatch)
    connection.execute("UPDATE company SET website_url='https://kept.test' WHERE company_id='cmp_0000000000000002'")
    connection.commit()

    queue_finder_page(
        connection, campaign_id="camp_0000000000000001", finder_run_id="camp_0000000000000002",
        policy_hash=HASH, company_id="cmp_0000000000000001", at=AT,
    )
    queue_finder_page(
        connection, campaign_id="camp_0000000000000001", finder_run_id="camp_0000000000000002",
        policy_hash=HASH, company_id="cmp_0000000000000002", at=AT,
    )

    assert connection.execute("SELECT website_url FROM company WHERE company_id='cmp_0000000000000001'").fetchone()[0] == "https://alpha.test"
    assert connection.execute("SELECT website_url FROM company WHERE company_id='cmp_0000000000000002'").fetchone()[0] == "https://kept.test"


def test_transport_uses_oauth_start_poll_and_no_network_fixture(monkeypatch):
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    calls = []

    class Response:
        def __init__(self, value): self.value = value
        def read(self): return json.dumps(self.value).encode()
        def __enter__(self): return self
        def __exit__(self, *args): return False

    values = iter([{"access_token": "token-private"}, _fixture("v2-prospects-start.json"), _fixture("v2-prospects-in-progress.json"), _fixture("v2-prospects-page-1.json")])
    def urlopen(request, timeout):
        calls.append((request.full_url, request.data))
        return Response(next(values))
    monkeypatch.setattr(vendors.urllib.request, "urlopen", urlopen)

    result = vendors._snov_domain_transport(domain="alpha.test", page=1, positions=())
    assert result["api_version"] == "v2"
    assert "grant_type=client_credentials" in calls[0][1].decode()
    assert "v2/domain-search/prospects/start" in calls[1][0]
    assert "positions" not in calls[1][0]
    assert calls[2][0].endswith("synthetic-task-page-1") and calls[3][0].endswith("synthetic-task-page-1")


def test_transport_does_not_call_retired_v1_endpoint(monkeypatch):
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    calls = []

    class Response:
        def read(self): return b'{"access_token":"token-private"}'
        def __enter__(self): return self
        def __exit__(self, *args): return False

    def urlopen(request, timeout):
        calls.append(request.full_url)
        if "v2/" in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 404, "gone", {}, io.BytesIO())
        return Response()
    monkeypatch.setattr(vendors.urllib.request, "urlopen", urlopen)
    with pytest.raises(VendorHttpError) as raised:
        vendors._snov_domain_transport(domain="alpha.test", page=1, positions=())
    assert raised.value.status == 404
    assert not any("v1/get-domain-search" in call for call in calls)


def test_unfiltered_pages_persist_non_candidates_without_promoting_them(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    calls = []

    def transport(**kwargs):
        calls.append(kwargs)
        assert set(kwargs) == {"domain", "page"}
        if kwargs["domain"] == "beta.test":
            return _fixture("v2-prospects-empty.json")
        return _fixture(f"v2-prospects-unfiltered-page{kwargs['page']}.json")

    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    _drain(connection, transport)

    titles = {row[0] for row in connection.execute("SELECT title FROM employment")}
    assert titles == {"Senior Associate", "Director of Strategy"}
    assert connection.execute(
        "SELECT 1 FROM source_observation WHERE field='title' AND value=json_quote('Executive Assistant')"
    ).fetchone() is not None
    assert all("positions" not in request for request in calls)


def test_oauth_and_http_errors_are_typed_and_redacted(monkeypatch):
    monkeypatch.setenv("SNOV_CLIENT_ID", "client-private")
    monkeypatch.setenv("SNOV_CLIENT_SECRET", "secret-private")
    def urlopen(request, timeout):
        raise urllib.error.HTTPError(SYNTHETIC["private_error_url"], 401, "no", {}, io.BytesIO())
    monkeypatch.setattr(vendors.urllib.request, "urlopen", urlopen)
    with pytest.raises(VendorHttpError) as raised:
        vendors._snov_domain_transport(domain="alpha.test", page=1, positions=())
    text = repr(raised.value) + repr(raised.value.__cause__) + repr(raised.value.__context__)
    assert raised.value.status == 401
    assert "client-private" not in text and "secret-private" not in text and "vendor.test" not in text


def test_failure_releases_reservation(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    row = connection.execute("SELECT * FROM exec_request WHERE state='queued' ORDER BY request_id LIMIT 1").fetchone()
    connection.execute("UPDATE exec_request SET state='claimed' WHERE request_id=?", (row["request_id"],))
    request = Executor._from_row(connection.execute("SELECT * FROM exec_request WHERE request_id=?", (row["request_id"],)).fetchone())
    with pytest.raises(RuntimeError):
        SnovDomainAdapter(connection, lambda **_: (_ for _ in ()).throw(RuntimeError("transport_failed"))).execute(request, AT)
    assert connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (request.request_id,)).fetchone()[0] == "released"


def test_page_rate_limit_is_typed_and_does_not_stop_other_pages(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)

    def transport(*, domain, **unused):
        if domain == "alpha.test":
            raise VendorHttpError("snov", 429)
        return {"data": [], "meta": {"credits": 0}}

    executor = Executor(connection)
    monkeypatch.setattr(vendors, "_snov_domain_transport", transport)
    vendors.attach_vendors(executor, now=AT, providers=("snov",))
    while executor.process_one():
        pass
    rows = connection.execute("SELECT state,reason FROM exec_request ORDER BY request_id").fetchall()
    assert ("rejected", "snov_rate_limited") in {(row["state"], row["reason"]) for row in rows}
    assert ("succeeded", "snov_domain_completed") in {(row["state"], row["reason"]) for row in rows}


def test_default_per_firm_cap_selects_two_title_classes(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)

    def transport(*, domain, **unused):
        return _fixture("v2-prospects-16.json") if domain == "alpha.test" else {"data": [], "meta": {"credits": 0}}

    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    _drain(connection, transport)
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 2
    assert {row[0] for row in connection.execute("SELECT title FROM employment")} == {"Associate", "Director"}


def test_campaign_credit_budget_refuses_before_first_page(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch, credit_budget=0)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    result = lane.run(lane.plan(None), None)
    assert result.shortfall_reason == "credit_budget"
    assert connection.execute("SELECT count(*) FROM snov_domain_page").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0


def test_continuation_cap_is_typed_and_settles_the_completed_page(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains, max_pages=1)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    row = connection.execute("SELECT * FROM exec_request WHERE state='queued' AND request_id IN (SELECT request_id FROM snov_domain_page WHERE domain='alpha.test')").fetchone()
    executor = Executor(connection)
    monkeypatch.setattr(vendors, "_snov_domain_transport", lambda **_: _fixture("v2-prospects-page-1.json"))
    vendors.attach_vendors(executor, now=AT, providers=("snov",), per_firm=2, max_pages=1)
    assert executor.process_one()
    assert tuple(connection.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (row["request_id"],)).fetchone()) == ("succeeded", "skipped_budget")
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] >= 1
    assert connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (row["request_id"],)).fetchone()[0] == "settled"


def test_domain_task_resumes_after_poll_bound_without_a_second_start(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    calls = []

    def in_progress(*, task_hash=None, **unused):
        calls.append(task_hash)
        return {
            "status": "in_progress", "meta": {"task_hash": "synthetic-domain-task"},
            "links": {"result": "https://api.snov.io/v2/domain-search/prospects/result/synthetic-domain-task"},
        }

    monkeypatch.setattr(vendors, "_snov_domain_transport", in_progress)
    first = Executor(connection)
    vendors.attach_vendors(first, now=AT, providers=("snov",))
    assert first.process_one()
    request_id = str(connection.execute("SELECT request_id FROM snov_domain_search").fetchone()[0])
    assert tuple(connection.execute("SELECT state FROM exec_request WHERE request_id=?", (request_id,)).fetchone()) == ("uncertain",)
    assert tuple(connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (request_id,)).fetchone()) == ("reserved",)

    def complete(*, task_hash=None, **unused):
        calls.append(task_hash)
        assert task_hash == "synthetic-domain-task"
        return {"status": "completed", "data": [], "meta": {"credits": 1}}

    monkeypatch.setattr(vendors, "_snov_domain_transport", complete)
    second = Executor(connection)
    vendors.attach_vendors(second, now=AT, providers=("snov",))
    assert second.process_one()
    assert tuple(connection.execute("SELECT state FROM exec_request WHERE request_id=?", (request_id,)).fetchone()) == ("succeeded",)
    assert tuple(connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (request_id,)).fetchone()) == ("settled",)
    assert calls.count(None) == 1


def test_start_ambiguity_retains_reservation_and_rechecks_before_resuming(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    row = connection.execute(
        """SELECT request.* FROM exec_request AS request
           JOIN snov_domain_page AS page ON page.request_id=request.request_id
           WHERE page.domain='alpha.test'"""
    ).fetchone()
    connection.execute("UPDATE exec_request SET state='claimed' WHERE request_id=?", (row["request_id"],))
    request = Executor._from_row(connection.execute("SELECT * FROM exec_request WHERE request_id=?", (row["request_id"],)).fetchone())

    def ambiguous_start(**unused):
        raise VendorHttpError("snov", 502)

    adapter = SnovDomainAdapter(connection, ambiguous_start)
    assert adapter.execute(request, AT) is None
    assert tuple(connection.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (request.request_id,)).fetchone()) == ("uncertain", "snov_domain_start_uncertain")
    assert tuple(connection.execute("SELECT task_hash,result_url FROM snov_domain_search WHERE request_id=?", (request.request_id,)).fetchone()) == ("snov-domain-start-pending", "pending://snov-domain-start")
    assert connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (request.request_id,)).fetchone()[0] == "reserved"

    calls = []
    def repeated_start(*, task_hash=None, result_url=None, **unused):
        calls.append((task_hash, result_url))
        return {
            "status": "in_progress", "meta": {"task_hash": "synthetic-domain-task"},
            "links": {"result": "https://api.snov.io/v2/domain-search/prospects/result/synthetic-domain-task"},
        }

    connection.execute("UPDATE exec_request SET state='claimed' WHERE request_id=?", (request.request_id,))
    assert SnovDomainAdapter(connection, repeated_start).execute(request, AT) is None
    assert calls == [(None, None)]
    assert connection.execute("SELECT count(*) FROM credit_reservation WHERE exec_request_id=?", (request.request_id,)).fetchone()[0] == 1

    def completed(*, task_hash=None, **unused):
        calls.append((task_hash, None))
        return {"status": "completed", "data": [], "meta": {"credits": 1}}

    connection.execute("UPDATE exec_request SET state='claimed' WHERE request_id=?", (request.request_id,))
    assert SnovDomainAdapter(connection, completed).execute(request, AT) is None
    assert calls[-1] == ("synthetic-domain-task", None)
    assert connection.execute("SELECT state FROM credit_reservation WHERE exec_request_id=?", (request.request_id,)).fetchone()[0] == "settled"


def test_thirty_initial_pages_settle_when_continuations_hit_the_global_cap(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch, credit_budget=40)
    with domains.open("a", encoding="utf-8") as target:
        for index in range(4, 32):
            company_id = f"cmp_{index:016x}"
            name, domain = f"Firm {index} Synthetic", f"firm-{index}.test"
            connection.execute("INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)", (company_id, name, None, None, None, None, None, "manual", f"company-{index}"))
            target.write(f"{name},{domain}\n")
    connection.commit()
    lane = SnovDomainLane(connection, domains, max_pages=30)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)
    assert connection.execute("SELECT count(*) FROM exec_request WHERE state='queued'").fetchone()[0] == 30

    def completed(*, page, **unused):
        return {"status": "completed", "data": [], "meta": {"credits": 1}, "links": {"next": "https://api.snov.io/v2/domain-search/prospects?page=2"} if page == 1 else {}}

    monkeypatch.setattr(vendors, "_snov_domain_transport", completed)
    executor = Executor(connection)
    vendors.attach_vendors(executor, now=AT, providers=("snov",))
    while executor.process_one():
        pass
    assert connection.execute("SELECT count(*) FROM exec_request WHERE state='rejected' AND reason='adapter_error'").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM exec_request WHERE state='succeeded' AND reason='skipped_budget'").fetchone()[0] == 30
    assert connection.execute("SELECT count(*) FROM credit_reservation WHERE state='settled'").fetchone()[0] == 30


def test_per_firm_cap_includes_people_from_prior_pages_and_executor_runs(tmp_path, monkeypatch):
    connection, domains = _store(tmp_path, monkeypatch)
    lane = SnovDomainLane(connection, domains)
    lane.bind_run("camp_0000000000000002")
    lane.run(lane.plan(None), None)

    def pages(*, domain, page, **unused):
        if domain != "alpha.test":
            return {"status": "completed", "data": [], "meta": {"credits": 0}}
        if page == 1:
            return {"status": "completed", "meta": {"credits": 1}, "links": {"next": "https://api.snov.io/v2/domain-search/prospects?page=2"}, "data": [{"prospect_id": "associate-1", "name": "Associate Synthetic", "position": "Associate"}]}
        return {"status": "completed", "meta": {"credits": 1}, "data": [
            {"prospect_id": "associate-2", "name": "Associate Duplicate", "position": "Associate"},
            {"prospect_id": "director-1", "name": "Director Synthetic", "position": "Director"},
            {"prospect_id": "director-2", "name": "Director Overflow", "position": "Director"},
        ]}

    monkeypatch.setattr(vendors, "_snov_domain_transport", pages)
    executor = Executor(connection)
    vendors.attach_vendors(executor, now=AT, providers=("snov",), per_firm=2)
    while executor.process_one():
        pass
    assert connection.execute("SELECT count(*) FROM employment WHERE company_id='cmp_0000000000000001'").fetchone()[0] == 2


@pytest.mark.parametrize(("title", "rule", "expected"), [
    ("Associate", {"class": "associate"}, True), ("Senior Associate", {"class": "associate"}, True),
    ("Investment Associate", {"class": "associate"}, True), ("Associate Partner", {"class": "associate"}, False),
    ("Senior Associate", {"class": "senior associate"}, True), ("Principal", {"class": "principal"}, True),
    ("Vice President", {"class": "vice president"}, True), ("Managing Director", {"class": "managing director"}, True),
    ("Partner", {"class": "partner"}, True), ("General Partner", {"class": "general partner"}, True),
    ("Senior Associate", {"class": "associate", "include_senior": False}, False),
    ("Managing Director", {"class": "director"}, False), ("Managing Director", {"class": "director", "include_managing_director": True}, True),
])
def test_title_semantics_and_documented_email_statuses(title, rule, expected):
    assert _title_matches(title, (rule,)) is expected
    assert [_contact_state(value) for value in ("valid", "unverified", "not_verified", "catch_all", "invalid", "new-status")] == ["valid", "risky", "risky", "catch_all", "invalid", "risky"]


def test_title_compounds_require_the_explicit_policy_flags():
    assert not _title_matches("Associate Partner", ({"class": "associate"},))
    assert not _title_matches("Associate Partner", ({"class": "partner"},))
    assert not _title_matches("Associate Director", ({"class": "director"},))
    assert _title_matches("Associate Director", ({"class": "director", "compound_titles": True},))
    assert _title_matches("Senior Associate", ({"class": "associate"},))
    assert not _title_matches("Managing Director", ({"class": "director"},))
    assert _title_matches("Managing Director", ({"class": "director", "include_managing_director": True},))


@pytest.mark.parametrize("title", [
    "Director of IT", "Director of Finance and Operations", "Talent Director", "Director Of Engineering",
    "Content & Community Associate", "Operations Associate", "Senior Finance Associate",
    "Senior Investor Relations Associate", "Director of Platform & Marketing", "Director Investor Database Administration",
])
def test_title_function_exclusions_block_candidate_classes(title):
    assert not _title_matches(title, ({"class": "associate"}, {"class": "director"}))


def test_empty_title_function_exclusions_disables_the_default_filter():
    assert _title_matches("Operations Associate", ({"class": "associate"},), ())
