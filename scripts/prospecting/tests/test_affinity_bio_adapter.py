"""Synthetic checks for the P8 bio snapshot adapter and research driver."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.prospecting import executor as executor_module
from scripts.prospecting.affinity import as_datetime
from scripts.prospecting.affinity import research as research_module
from scripts.prospecting.affinity.anchors import load_anchors
from scripts.prospecting.affinity.bio_adapter import BROWSER_HEADERS, _browser_http, register_bio_adapter
from scripts.prospecting.fetcher import FetchPolicy
from scripts.prospecting.affinity.research import _request_id, research_run
from scripts.prospecting.fetcher import FetchResponse
from scripts.prospecting.operator import vendors
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.store import ExecRequest, insert_exec_request, open_store


FIXTURES = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures" / "affinity"
NOW = datetime(2099, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
ANCHORS = load_anchors(FIXTURES / "sender-anchors-synthetic.json")


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):  # type: ignore[no-untyped-def]
        return NOW if tz is None else NOW.astimezone(tz)


def _fixture_transport(url: str) -> FetchResponse:
    if url.endswith("/team/morgan-example"):
        body = (FIXTURES / "bio-person-full.html").read_bytes()
    elif url.endswith("/team"):
        body = (FIXTURES / "bio-team-index.html").read_bytes()
    else:
        body = b'<html><head><meta name="description" content="Alpha Ventures"></head><body><a href="/team">Team</a></body></html>'
    return FetchResponse(body, "text/html", url)


def _offsite_transport(url: str) -> FetchResponse:
    return FetchResponse(b"<html></html>", "text/html", "https://offsite.test/team")


def _person_url(person_id: str) -> str | None:
    return "https://alpha.test/team/morgan-example" if person_id == "per_0000000000000001" else None


def _executor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(vendors, "datetime", _FrozenDatetime)
    connection = open_store(tmp_path / "store.sqlite")
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("cmp_0000000000000001", "Alpha Ventures", "https://alpha.test/", "manual", "alpha"),
    )
    return connection, executor_module.Executor(connection)


def _queue_snapshot(connection, entity_id: str) -> None:
    request = ExecRequest(
        "req_" + entity_id.removeprefix("cmp_").removeprefix("per_"),
        "prospecting-list-builder", "fetch_snapshot",
        {"entity_id": entity_id, "snapshot_id": "obs_0000000000000001"}, "0" * 64,
        None, "2099-01-02T03:04:05Z",
    )
    insert_exec_request(connection, request, "T0")


def _run_one(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entity_id: str, transport):
    connection, executor = _executor(tmp_path, monkeypatch)
    if entity_id.startswith("per_"):
        connection.execute(
            "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
            (entity_id, "Morgan", "Morgan Example", "manual", "morgan"),
        )
    monkeypatch.setattr(vendors, "_http", lambda url, policy: transport(url))
    register_bio_adapter(executor, _person_url, now=NOW, transport=transport)
    _queue_snapshot(connection, entity_id)
    assert executor.process_one()
    request = tuple(connection.execute("SELECT state,reason FROM exec_request").fetchone())
    snapshot = connection.execute(
        "SELECT entity_id,source_url,source_domain,retrieved_at,content_type,content_sha256,"
        "allowlist_version,body_ref,expires_at,retention_delete_at FROM source_snapshot"
    ).fetchone()
    return request, snapshot


def test_company_ids_still_upsert_the_firm_blurb(tmp_path, monkeypatch) -> None:
    connection, executor = _executor(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))
    register_bio_adapter(executor, _person_url, now=NOW, transport=_fixture_transport)
    _queue_snapshot(connection, "cmp_0000000000000001")
    while executor.process_one():
        pass
    assert connection.execute(
        "SELECT blurb FROM company_profile WHERE company_id='cmp_0000000000000001'"
    ).fetchone()[0] != ""


def test_person_and_company_paths_write_identically_shaped_snapshot_rows(tmp_path, monkeypatch) -> None:
    person_request, person = _run_one(tmp_path / "person", monkeypatch, "per_0000000000000001", _fixture_transport)
    company_request, company = _run_one(tmp_path / "company", monkeypatch, "cmp_0000000000000001", _fixture_transport)
    assert person_request == company_request == ("succeeded", "snapshot_profiled")
    assert set(person.keys()) == set(company.keys())
    assert person["allowlist_version"] == "p8-bio-v1"


def test_an_offsite_redirect_is_blocked_on_both_paths(tmp_path, monkeypatch) -> None:
    for entity in ("cmp_0000000000000001", "per_0000000000000001"):
        (state, reason), _snapshot = _run_one(tmp_path / entity, monkeypatch, entity, _offsite_transport)
        assert (state, reason) == ("rejected", "fetch_domain_blocked")


def test_person_transport_uses_browser_headers_and_the_allowlisted_opener(tmp_path, monkeypatch) -> None:
    captured = {}

    class Response:
        headers = type("Headers", (), {"get_content_type": lambda self: "text/html"})()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, limit):
            assert limit == 2 * 1024 * 1024
            return b"<html></html>"

        def geturl(self):
            return "https://alpha.test/people"

    class Opener:
        def open(self, request, timeout):
            assert timeout == 20
            captured.update({key.casefold(): value for key, value in request.header_items()})
            return Response()

    def fake_build_opener(redirect):
        assert redirect.policy.allowed_hosts == ("alpha.test", "www.alpha.test")
        return Opener()

    monkeypatch.setattr("scripts.prospecting.affinity.bio_adapter.urlrequest.build_opener", fake_build_opener)
    response = _browser_http(
        "https://alpha.test/people",
        FetchPolicy(("alpha.test", "www.alpha.test"), "test", tmp_path),
    )
    assert {key.casefold(): value for key, value in BROWSER_HEADERS.items()}.items() <= captured.items()
    assert response.body == b"<html></html>"


def test_registration_after_the_first_claim_is_refused(tmp_path, monkeypatch) -> None:
    connection, executor = _executor(tmp_path, monkeypatch)
    register_bio_adapter(executor, _person_url, now=NOW)
    executor.process_one()
    with pytest.raises(RuntimeError, match="registry_locked"):
        register_bio_adapter(executor, _person_url, now=NOW)


def test_snapshot_rows_carry_the_injected_clock(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "datetime", _FrozenDatetime)
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))
    research_run(connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory)
    rows = connection.execute("SELECT retrieved_at, expires_at FROM source_snapshot").fetchall()
    assert rows and all(row["retrieved_at"].startswith(NOW.strftime("%Y-%m-%d")) for row in rows)
    assert all(as_datetime(row["expires_at"]) > NOW for row in rows)


def _factory(connection):
    executor = executor_module.Executor(connection)
    executor.bio_transport = _fixture_transport
    return executor


def _seeded_campaign(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("cmp_0000000000000001", "Alpha Ventures", "https://alpha.test/", "manual", "alpha"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("per_0000000000000001", "Morgan", "Morgan Example", "manual", "morgan"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_employment_seed", "employment", "per_0000000000000001", "seed", "{}", "obs_seed", "2099-01-02T03:04:05Z", 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000001", "per_0000000000000001", "cmp_0000000000000001", "Investor", "obs_employment_seed", 1.0),
    )
    connection.execute(
        "INSERT INTO fill_firm(campaign_id,company_id,target_per_firm,max_candidates,status,updated_at) VALUES(?,?,?,?,?,?)",
        (campaign_id, "cmp_0000000000000001", 1, 3, "selected", "2099-01-02T03:04:05Z"),
    )
    return connection, campaign_id


def test_second_research_run_writes_nothing(tmp_path, monkeypatch, record_property) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))
    first = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                         executor_factory=_factory, max_bio_pages=6)
    before = {table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
              for table in ("source_snapshot", "source_observation", "person_research_state")}
    second = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                          executor_factory=_factory, max_bio_pages=6)
    after = {table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
             for table in before}
    assert after == before
    assert first.bio_pages_fetched > 0 and second.bio_pages_fetched == 0
    record_property("refire_noop_runs", 1)


def test_a_blocked_bio_leaves_a_typed_state_the_adapter_could_not_write(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))

    def blocked_factory(db):
        executor = executor_module.Executor(db)
        executor.bio_transport = _offsite_transport
        return executor

    research_run(connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=blocked_factory)
    row = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    assert (row["bio_state"], row["reason"]) == ("blocked", "bio_page_blocked")


def test_research_retries_a_transient_bio_fetch_on_the_next_run(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, _policy: _fixture_transport(url))
    failing = {"value": True}

    def transient_transport(url: str) -> FetchResponse:
        if failing["value"] and url.endswith("/team/morgan-example"):
            raise OSError("synthetic transport failure")
        return _fixture_transport(url)

    def transient_factory(db):
        executor = executor_module.Executor(db)
        executor.bio_transport = transient_transport
        return executor

    first = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                         executor_factory=transient_factory, max_bio_pages=6)
    failing["value"] = False
    second = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                          executor_factory=transient_factory, max_bio_pages=6)

    state = connection.execute(
        "SELECT bio_state FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchone()["bio_state"]
    base = _request_id(campaign_id, "per_0000000000000001", "bio")
    retry = _request_id(campaign_id, "per_0000000000000001", "bio#a1")
    outcomes = dict(connection.execute(
        "SELECT request_id,state FROM exec_request WHERE request_id IN (?,?)", (base, retry)
    ).fetchall())
    assert first.reason_codes["bio_page_transport_error"] == 1
    assert state == "fetched"
    assert outcomes == {base: "rejected", retry: "succeeded"}
    assert second.retried == 1 and second.retry_exhausted == 0


def test_research_does_not_retry_a_domain_blocked_bio_fetch(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, _policy: _fixture_transport(url))

    def blocked_person_transport(url: str) -> FetchResponse:
        return _offsite_transport(url) if url.endswith("/team/morgan-example") else _fixture_transport(url)

    def blocked_person_factory(db):
        executor = executor_module.Executor(db)
        executor.bio_transport = blocked_person_transport
        return executor

    research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                 executor_factory=blocked_person_factory, max_bio_pages=6)
    second = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                          executor_factory=_factory, max_bio_pages=6)

    state = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    retry = _request_id(campaign_id, "per_0000000000000001", "bio#a1")
    assert (state["bio_state"], state["reason"]) == ("blocked", "bio_page_blocked")
    assert connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (retry,)).fetchone() is None
    assert second.retried == 0


def test_research_caps_transient_bio_fetches_after_three_attempts(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(vendors, "_http", lambda url, _policy: _fixture_transport(url))

    def failing_transport(url: str) -> FetchResponse:
        if url.endswith("/team/morgan-example"):
            raise OSError("synthetic transport failure")
        return _fixture_transport(url)

    def failing_factory(db):
        executor = executor_module.Executor(db)
        executor.bio_transport = failing_transport
        return executor

    for _ in range(3):
        research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                     executor_factory=failing_factory, max_bio_pages=6)
    exhausted = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW,
                             executor_factory=failing_factory, max_bio_pages=6)

    state = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    request_ids = [_request_id(campaign_id, "per_0000000000000001", suffix)
                   for suffix in ("bio", "bio#a1", "bio#a2")]
    states = connection.execute(
        "SELECT state FROM exec_request WHERE request_id IN (?,?,?)", request_ids
    ).fetchall()
    assert (state["bio_state"], state["reason"]) == ("error", "retry_exhausted")
    assert exhausted.retry_exhausted == 1
    assert [row["state"] for row in states] == ["rejected", "rejected", "rejected"]


def test_research_skips_a_legacy_person_id_without_aborting_the_firm(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    legacy_id = "123e4567-e89b-12d3-a456-426614174000"
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (legacy_id, "Legacy", "Legacy Person", "manual", "legacy-person"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_0000000000000002", "employment", legacy_id, "seed", "{}", "manual", "2099-01-02T03:04:05Z", 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000002", legacy_id, "cmp_0000000000000001", "Partner", "obs_0000000000000002", 1.0),
    )
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))

    summary = research_run(connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory)

    assert (summary.researched, summary.skipped_untyped) == (1, 1)
    row = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE person_id=? AND campaign_id=?",
        (legacy_id, campaign_id),
    ).fetchone()
    assert (row["bio_state"], row["reason"]) == ("error", "untyped_id")
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE json_extract(payload, '$.entity_id')=?", (legacy_id,)
    ).fetchone()[0] == 0


def test_research_probes_people_page_and_persists_inline_bio_facts(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    homepage = (FIXTURES / "bio-home-no-team-link.html").read_bytes()
    people = (FIXTURES / "bio-people-inline.html").read_bytes()

    def probe_transport(url: str) -> FetchResponse:
        return FetchResponse(people if url.endswith("/people") else homepage, "text/html", url)

    monkeypatch.setattr(vendors, "_http", lambda url, _policy: probe_transport(url))

    def probe_factory(db):
        executor = executor_module.Executor(db)
        executor.bio_transport = probe_transport
        return executor

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=probe_factory, max_bio_pages=6,
    )
    state = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    assert (state["bio_state"], state["reason"]) == ("fetched", "bio_page_via:/people")
    assert summary.bio_via_probe == 1
    assert summary.reason_codes["bio_page_via:/people"] == 1
    assert connection.execute("SELECT count(*) FROM person_education").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM person_employer").fetchone()[0] == 1


def test_research_loads_operator_supplied_linkedin_text_without_a_lane(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    person_id = "per_0000000000000001"
    (pages / f"{person_id}.txt").write_text(
        "<p>Experience</p><p>Analyst</p><p>Meridian Bank</p><p>Jan 2012 - Dec 2016</p>"
        "<p>Education</p><p>Newtown University</p><p>BBA</p><p>2010 - 2014</p>",
        encoding="utf-8",
    )
    (pages / "per_ffffffffffffffff.txt").write_text("stranger", encoding="utf-8")
    monkeypatch.setattr(vendors, "_http", lambda url, _policy: _fixture_transport(url))

    monkeypatch.setattr(research_module, "needs_linkedin", lambda _facts: True)
    monkeypatch.setattr(research_module, "_linkedin_lane", lambda *_args, **_kwargs: pytest.fail("lane_started"))
    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=1, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT linkedin_state,linkedin_loads,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    assert tuple(state) == ("loaded", 1, "linkedin_operator_supplied")
    assert (summary.linkedin_loads_used, summary.linkedin_operator_pages) == (1, 1)
    assert connection.execute(
        "SELECT count(*) FROM person_education WHERE school_norm='newtown university'"
    ).fetchone()[0] == 1
    assert connection.execute(
        "SELECT count(*) FROM person_employer WHERE employer_norm='meridian bank'"
    ).fetchone()[0] == 1
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE request_id LIKE '%linkedin%'"
    ).fetchone()[0] == 0


def test_operator_linkedin_pages_respect_the_run_cap(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    (pages / "per_0000000000000001.txt").write_text("<p>Experience</p>", encoding="utf-8")
    monkeypatch.setattr(vendors, "_http", lambda url, _policy: _fixture_transport(url))
    monkeypatch.setattr(research_module, "needs_linkedin", lambda _facts: True)

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=0, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT linkedin_state,linkedin_loads FROM person_research_state WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    assert tuple(state) == ("cap_reached", 0)
    assert (summary.linkedin_loads_used, summary.linkedin_operator_pages) == (0, 0)


_OPERATOR_PAGE_TEXT = (
    "Experience\nSenior Analyst\nMeridian Bank · Full-time\nJan 2099 - Present · 1 yr\n"
    "Education\nNewtown University\nBachelor of Science\n2095 - 2099\n"
)


def _seed_person_research_state(connection, campaign_id: str, person_id: str, *, bio_state: str,
                                bio_pages: int, linkedin_state: str, linkedin_loads: int, reason: str) -> None:
    connection.execute(
        "INSERT INTO person_research_state("
        "person_id,campaign_id,bio_state,bio_pages,linkedin_state,linkedin_loads,reason,updated_at"
        ") VALUES(?,?,?,?,?,?,?,?)",
        (person_id, campaign_id, bio_state, bio_pages, linkedin_state, linkedin_loads, reason,
         "2099-01-01T00:00:00Z"),
    )


def test_operator_pages_recover_a_retry_exhausted_candidate(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    _seed_person_research_state(
        connection, campaign_id, "per_0000000000000001",
        bio_state="error", bio_pages=3, linkedin_state="disabled", linkedin_loads=0, reason="retry_exhausted",
    )
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    (pages / "per_0000000000000001.txt").write_text(_OPERATOR_PAGE_TEXT, encoding="utf-8")

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=5, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT bio_state,linkedin_state FROM person_research_state WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    assert (state["bio_state"], state["linkedin_state"]) == ("error", "loaded")
    assert summary.linkedin_operator_pages == 1
    assert connection.execute(
        "SELECT count(*) FROM person_employer WHERE person_id='per_0000000000000001'"
    ).fetchone()[0] >= 1
    assert connection.execute(
        "SELECT count(*) FROM person_education WHERE person_id='per_0000000000000001'"
    ).fetchone()[0] >= 1


def test_operator_pages_recover_a_fetched_bio_with_linkedin_disabled(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    _seed_person_research_state(
        connection, campaign_id, "per_0000000000000001",
        bio_state="fetched", bio_pages=1, linkedin_state="disabled", linkedin_loads=0, reason="linkedin_disabled",
    )
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    (pages / "per_0000000000000001.txt").write_text(_OPERATOR_PAGE_TEXT, encoding="utf-8")

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=5, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT bio_state,linkedin_state,linkedin_loads,reason FROM person_research_state WHERE campaign_id=?",
        (campaign_id,),
    ).fetchone()
    assert tuple(state) == ("fetched", "loaded", 1, "linkedin_operator_supplied")
    assert summary.linkedin_operator_pages == 1


def test_operator_pages_do_not_reparse_an_already_loaded_person(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    _seed_person_research_state(
        connection, campaign_id, "per_0000000000000001",
        bio_state="fetched", bio_pages=1, linkedin_state="loaded", linkedin_loads=1,
        reason="linkedin_operator_supplied",
    )
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    (pages / "per_0000000000000001.txt").write_text(_OPERATOR_PAGE_TEXT, encoding="utf-8")

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=5, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT linkedin_loads FROM person_research_state WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    assert state["linkedin_loads"] == 1
    assert summary.linkedin_operator_pages == 0


def test_operator_pages_stop_after_the_run_cap_across_people(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("per_0000000000000002", "Casey", "Casey Example", "manual", "casey"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence)"
        " VALUES(?,?,?,?,?,?,?,?)",
        ("obs_employment_seed_2", "employment", "per_0000000000000002", "seed", "{}", "obs_seed",
         "2099-01-02T03:04:05Z", 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence)"
        " VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000002", "per_0000000000000002", "cmp_0000000000000001", "Investor",
         "obs_employment_seed_2", 1.0),
    )
    for person_id in ("per_0000000000000001", "per_0000000000000002"):
        _seed_person_research_state(
            connection, campaign_id, person_id,
            bio_state="error", bio_pages=0, linkedin_state="disabled", linkedin_loads=0, reason="retry_exhausted",
        )
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    for person_id in ("per_0000000000000001", "per_0000000000000002"):
        (pages / f"{person_id}.txt").write_text(_OPERATOR_PAGE_TEXT, encoding="utf-8")

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=1, linkedin_pages_dir=pages,
    )

    assert summary.linkedin_operator_pages == 1
    loaded = connection.execute(
        "SELECT count(*) FROM person_research_state WHERE campaign_id=? AND linkedin_state='loaded'", (campaign_id,),
    ).fetchone()[0]
    assert loaded == 1


def test_operator_pages_mark_an_empty_supplied_page_loaded(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    _seed_person_research_state(
        connection, campaign_id, "per_0000000000000001",
        bio_state="error", bio_pages=0, linkedin_state="disabled", linkedin_loads=0, reason="retry_exhausted",
    )
    pages = tmp_path / "linkedin-pages"
    pages.mkdir()
    (pages / "per_0000000000000001.txt").write_text("", encoding="utf-8")

    summary = research_run(
        connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory,
        max_linkedin=5, linkedin_pages_dir=pages,
    )

    state = connection.execute(
        "SELECT linkedin_state FROM person_research_state WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    assert state["linkedin_state"] == "loaded"
    assert summary.linkedin_operator_pages == 1
    assert summary.linkedin_operator_empty == 1


def test_research_leaves_a_foreign_queued_request_untouched(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _seeded_campaign(tmp_path, monkeypatch)
    connection.execute(
        """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state)
           VALUES(?,?,?,?,?,?,?,?)""",
        ("req_foreign_vendor", "prospecting-list-builder", "vendor_lookup", "{}",
         connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0],
         None, "2099-01-02T03:04:05Z", "queued"),
    )
    with pytest.raises(ValueError, match="foreign_requests_queued"):
        research_run(connection, campaign_id, anchors=ANCHORS, now=NOW, executor_factory=_factory)
    assert connection.execute(
        "SELECT state FROM exec_request WHERE request_id='req_foreign_vendor'"
    ).fetchone()[0] == "queued"
