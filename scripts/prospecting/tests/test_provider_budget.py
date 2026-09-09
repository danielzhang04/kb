import inspect
import socket

import pytest

from scripts.prospecting.executor import Executor
from scripts.prospecting.finder_apify_public import ApifyPublicProfileAdapter
from scripts.prospecting.finder_pdl import PDLSpotAdapter
from scripts.prospecting.providers.base import queue_vendor_lookup, register_vendor_adapters
from scripts.prospecting.providers.hunter import HunterEmailFinder
from scripts.prospecting.providers.snov import SnovEmailFinder
from scripts.prospecting.store import open_store


CAMPAIGN_ID = "camp_1111111111111111"
POLICY_HASH = "a" * 64
NOW = "2026-09-03T00:00:00Z"


def _request_id(index: int) -> str:
    return f"req_{index:016x}"


def _person_id(index: int) -> str:
    return f"per_{index:016x}"


def _seed(connection, *, budget: int = 1000, people: int = 2):
    connection.execute(
        """INSERT INTO sender_profile(
               sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?)""",
        ("sender-1", "v", "v", "v", "v", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,
               send_window,timezone,approval_tier,mailbox_id,evidence_rules,policy_hash,status,credit_budget
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (CAMPAIGN_ID, "sales", "sender-1", "{}", "informational_call", "direct", "synthetic", "[]", "synthetic", "UTC", "T0",
         "mailbox-1", "{}", POLICY_HASH, "active", budget),
    )
    connection.executemany(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ((_person_id(index), "v", "v", "manual", f"key-{index}") for index in range(people)),
    )
    connection.commit()


def _adapters(*, pdl_transport=None):
    return {
        "pdl": PDLSpotAdapter(transport=pdl_transport),
        "apify": ApifyPublicProfileAdapter(),
        "hunter": HunterEmailFinder(),
        "snov": SnovEmailFinder(),
    }


def test_all_four_providers_queue_through_the_generic_vendor_route(tmp_path, monkeypatch, record_property):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "generic.sqlite")
    _seed(connection)
    adapters = _adapters()
    for index, adapter in enumerate(adapters.values()):
        adapter.queue(
            connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
            request_id=_request_id(index), now=NOW,
        )
    assert set(
        row[0] for row in connection.execute("SELECT json_extract(payload, '$.provider') FROM exec_request")
    ) == set(adapters)
    assert connection.execute("SELECT COUNT(*) FROM credit_reservation").fetchone()[0] == 4
    record_property("single_credit_reservation_assertions", 1)


def test_executor_rejects_claim_without_a_matching_reservation_before_transport(tmp_path, monkeypatch):
    monkeypatch.delenv("KB_PROSPECTING_NO_NETWORK", raising=False)
    connection = open_store(tmp_path / "missing-reservation.sqlite")
    _seed(connection)
    calls = []
    adapters = _adapters(pdl_transport=lambda *_: calls.append("called") or {
        "result": "valid", "credits": 1, "records": [],
    })
    executor = Executor(connection)
    register_vendor_adapters(executor, adapters, now=NOW)
    request_id = _request_id(1)
    adapters["pdl"].queue(
        connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
        request_id=request_id, now=NOW,
    )
    connection.execute("DELETE FROM credit_reservation WHERE exec_request_id=?", (request_id,))
    connection.commit()
    assert executor.process_one()
    assert calls == []
    assert connection.execute("SELECT state FROM exec_request WHERE request_id=?", (request_id,)).fetchone()[0] == "rejected"


def test_pdl_month_cap_reserves_exactly_one_hundred_units_atomically(tmp_path, monkeypatch, record_property):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "pdl-cap.sqlite")
    _seed(connection, budget=200)
    adapter = PDLSpotAdapter()
    for index in range(100):
        adapter.queue(
            connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
            request_id=_request_id(index), now=NOW,
        )
    capped_request = _request_id(100)
    adapter.queue(
        connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
        request_id=capped_request, now=NOW,
    )
    assert connection.execute("SELECT COUNT(*) FROM credit_reservation WHERE provider='pdl'").fetchone()[0] == 100
    assert connection.execute(
        "SELECT reason FROM exec_request WHERE request_id=?", (capped_request,)
    ).fetchone()[0] == "skipped_budget"
    record_property("credit_overage_rejections", 1)


def test_registered_executor_path_settles_reserved_pdl_call(tmp_path, monkeypatch, record_property):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "settle.sqlite")
    _seed(connection)
    adapters = _adapters()
    executor = Executor(connection)
    register_vendor_adapters(executor, adapters, now=NOW)
    request_id = _request_id(2)
    adapters["pdl"].queue(
        connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
        request_id=request_id, now=NOW,
    )
    assert executor.process_one()
    assert connection.execute("SELECT state FROM exec_request WHERE request_id=?", (request_id,)).fetchone()[0] == "succeeded"
    assert connection.execute(
        "SELECT COUNT(*) FROM credit_reservation WHERE exec_request_id=? AND state='settled'", (request_id,)
    ).fetchone()[0] == 1
    record_property("attempt_reservation_settlement_assertions", 1)


def test_vendor_queue_rejects_cookie_and_session_inputs(tmp_path, record_property):
    connection = open_store(tmp_path / "custody.sqlite")
    _seed(connection)
    adapter = HunterEmailFinder()
    for index, payload in enumerate(({"cookie": "class-b"}, {"session": "class-b"})):
        with pytest.raises(ValueError, match="raw_vendor_payload_rejected"):
            queue_vendor_lookup(
                connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), provider="hunter",
                vendor_operation="find", payload=payload, policy_hash=POLICY_HASH,
                request_id=_request_id(index), adapter=adapter, now=NOW,
            )
    record_property("cookie_inputs_rejected", 1)


def test_public_vendor_surface_never_opens_a_socket(monkeypatch, tmp_path):
    class FailSocket:
        def __init__(self, *args, **kwargs):
            raise AssertionError("public_vendor_surface_opened_socket")

    monkeypatch.setattr(socket, "socket", FailSocket)
    import scripts.prospecting.finder_apify_public as apify_module
    import scripts.prospecting.finder_pdl as pdl_module
    import scripts.prospecting.providers.base as base_module
    import scripts.prospecting.providers.hunter as hunter_module
    import scripts.prospecting.providers.snov as snov_module

    modules = (base_module, pdl_module, apify_module, hunter_module, snov_module)
    public = {
        module.__name__: tuple(
            name for name, value in vars(module).items()
            if not name.startswith("_") and callable(value) and getattr(value, "__module__", None) == module.__name__
        )
        for module in modules
    }
    assert "queue_vendor_lookup" in public[base_module.__name__]
    assert all("call" not in names for names in public.values())
    for module in modules:
        for name, value in vars(module).items():
            if name.startswith("_") or getattr(value, "__module__", None) != module.__name__:
                continue
            if inspect.isfunction(value):
                assert "transport(" not in inspect.getsource(value)
            if inspect.isclass(value):
                for method_name, method in vars(value).items():
                    if not method_name.startswith("_") and inspect.isfunction(method):
                        assert "transport(" not in inspect.getsource(method)

    connection = open_store(tmp_path / "public-surface.sqlite")
    _seed(connection)
    adapters = _adapters()
    for index, adapter in enumerate(adapters.values()):
        assert adapter.max_cost(("person_search", "profile_batch", "find", "find")[index]) == 1
        adapter.queue(
            connection, campaign_id=CAMPAIGN_ID, person_id=_person_id(0), policy_hash=POLICY_HASH,
            request_id=_request_id(index), now=NOW,
        )
    executor = Executor(connection)
    register_vendor_adapters(executor, adapters, now=NOW)
    assert base_module.normalize_contact_state("hunter", "valid") == "valid"
    assert apify_module.map_apify_record({})[0]["source_lane"] == "class_c_public_profile"
    assert inspect.signature(register_vendor_adapters).parameters["adapters"].kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
